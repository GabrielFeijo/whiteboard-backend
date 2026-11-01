import { Injectable } from '@nestjs/common';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { ElementDataSchema, getDocRoots, LIMITS, Role } from '../../../shared';

export const SyncValidationFailureReason = {
  VIEWER_READ_ONLY: 'VIEWER_READ_ONLY',
  META_FORBIDDEN: 'META_FORBIDDEN',
  ELEMENT_QUOTA_EXCEEDED: 'ELEMENT_QUOTA_EXCEEDED',
  INVALID_ELEMENT_SCHEMA: 'INVALID_ELEMENT_SCHEMA',
} as const;
export type SyncValidationFailureReason =
  (typeof SyncValidationFailureReason)[keyof typeof SyncValidationFailureReason];

export interface SyncValidationResult {
  valid: boolean;
  reason?: SyncValidationFailureReason;
}

function extractModifiedElementId(
  target: unknown,
  rootElements: Y.Map<Y.Map<unknown>>,
): string | null {
  if (!(target instanceof Y.Map) || target === rootElements) {
    return null;
  }
  let current: Y.Map<unknown> | null = target;
  while (current && current.parent !== rootElements && current.parent instanceof Y.Map) {
    current = current.parent;
  }
  if (!current || current.parent !== rootElements) {
    return null;
  }
  const id = current.get('id');
  return typeof id === 'string' ? id : null;
}

function isValidElementMap(elementMap: unknown): boolean {
  if (!(elementMap instanceof Y.Map)) {
    return false;
  }
  const rawElement = elementMap.toJSON();
  return ElementDataSchema.safeParse(rawElement).success;
}

@Injectable()
export class YjsValidatorService {
  validateSyncUpdate(
    currentDoc: Y.Doc,
    syncPayloadAfterMsgType: Uint8Array,
    role: Role,
    shadowDocMirror?: Y.Doc,
  ): SyncValidationResult {
    if (role === Role.VIEWER) {
      return { valid: false, reason: SyncValidationFailureReason.VIEWER_READ_ONLY };
    }

    const shadowDoc = shadowDocMirror ?? new Y.Doc();
    const shouldDestroy = !shadowDocMirror;

    try {
      if (shouldDestroy) {
        const currentState = Y.encodeStateAsUpdate(currentDoc);
        Y.applyUpdate(shadowDoc, currentState);
      }

      const currentRoots = getDocRoots(currentDoc);
      const prevElementCount = currentRoots.elements.size;
      const lockedElementIds = new Set<string>();
      currentRoots.elements.forEach((elMap, id) => {
        if (elMap instanceof Y.Map && elMap.get('locked') === true) {
          lockedElementIds.add(id);
        }
      });

      let mutationTracking: {
        metaModified: boolean;
        commentsModified: boolean;
        modifiedElementKeys: Set<string>;
      };
      try {
        mutationTracking = this.applyAndTrackMutations(shadowDoc, syncPayloadAfterMsgType);
      } catch {
        return { valid: false, reason: SyncValidationFailureReason.INVALID_ELEMENT_SCHEMA };
      }

      const { metaModified, commentsModified, modifiedElementKeys } = mutationTracking;

      if (role !== Role.OWNER && metaModified) {
        return { valid: false, reason: SyncValidationFailureReason.META_FORBIDDEN };
      }

      if (commentsModified) {
        return { valid: false, reason: SyncValidationFailureReason.INVALID_ELEMENT_SCHEMA };
      }

      const shadowRoots = getDocRoots(shadowDoc);
      if (
        shadowRoots.elements.size > LIMITS.MAX_ELEMENTS &&
        shadowRoots.elements.size >= prevElementCount
      ) {
        return { valid: false, reason: SyncValidationFailureReason.ELEMENT_QUOTA_EXCEEDED };
      }

      if (
        !this.areModifiedElementsValid(
          shadowRoots.elements,
          modifiedElementKeys,
          lockedElementIds,
        )
      ) {
        return { valid: false, reason: SyncValidationFailureReason.INVALID_ELEMENT_SCHEMA };
      }

      return { valid: true };
    } finally {
      if (shouldDestroy) {
        shadowDoc.destroy();
      }
    }
  }

  private applyAndTrackMutations(
    shadowDoc: Y.Doc,
    syncPayloadAfterMsgType: Uint8Array,
  ): { metaModified: boolean; commentsModified: boolean; modifiedElementKeys: Set<string> } {
    const shadowRoots = getDocRoots(shadowDoc);
    let metaModified = false;
    let commentsModified = false;
    const modifiedElementKeys = new Set<string>();

    const metaDeepObserver = () => {
      metaModified = true;
    };
    const commentsDeepObserver = () => {
      commentsModified = true;
    };
    const elementsObserver: Parameters<typeof shadowRoots.elements.observe>[0] = (event) => {
      event.keys.forEach((_change, key) => modifiedElementKeys.add(key));
    };
    const elementsDeepObserver: Parameters<typeof shadowRoots.elements.observeDeep>[0] = (events) => {
      for (const ev of events) {
        const id = extractModifiedElementId(ev.target, shadowRoots.elements);
        if (id) {
          modifiedElementKeys.add(id);
        }
      }
    };

    shadowRoots.meta.observeDeep(metaDeepObserver);
    shadowRoots.comments.observeDeep(commentsDeepObserver);
    shadowRoots.elements.observe(elementsObserver);
    shadowRoots.elements.observeDeep(elementsDeepObserver);

    try {
      const decoder = decoding.createDecoder(syncPayloadAfterMsgType);
      const dummyEncoder = encoding.createEncoder();
      syncProtocol.readSyncMessage(decoder, dummyEncoder, shadowDoc, 'validator');
    } finally {
      shadowRoots.meta.unobserveDeep(metaDeepObserver);
      shadowRoots.comments.unobserveDeep(commentsDeepObserver);
      shadowRoots.elements.unobserve(elementsObserver);
      shadowRoots.elements.unobserveDeep(elementsDeepObserver);
    }

    return { metaModified, commentsModified, modifiedElementKeys };
  }

  private areModifiedElementsValid(
    elements: Y.Map<Y.Map<unknown>>,
    modifiedElementKeys: Set<string>,
    lockedElementIds: Set<string>,
  ): boolean {
    for (const key of modifiedElementKeys) {
      const elementMap = elements.get(key);
      const wasLocked = lockedElementIds.has(key);

      if (!elementMap && wasLocked) {
        return false;
      }
      if (!elementMap) {
        continue;
      }

      if (wasLocked && elementMap.get('locked') === true) {
        return false;
      }

      if (elementMap.get('id') !== key) {
        return false;
      }

      if (!isValidElementMap(elementMap)) {
        return false;
      }
    }
    return true;
  }
}
