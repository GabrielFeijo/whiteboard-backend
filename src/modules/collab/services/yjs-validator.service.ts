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

      const shadowRoots = getDocRoots(shadowDoc);
      let metaModified = false;
      const modifiedElementKeys = new Set<string>();

      const metaDeepObserver = () => {
        metaModified = true;
      };
      shadowRoots.meta.observeDeep(metaDeepObserver);

      const elementsObserver: Parameters<typeof shadowRoots.elements.observe>[0] = (event) => {
        event.keys.forEach((_change, key) => {
          modifiedElementKeys.add(key);
        });
      };
      shadowRoots.elements.observe(elementsObserver);

      const elementsDeepObserver: Parameters<typeof shadowRoots.elements.observeDeep>[0] = (
        events,
      ) => {
        for (const ev of events) {
          if (ev.target !== shadowRoots.elements && ev.target instanceof Y.Map) {
            let curr: Y.Map<unknown> | null = ev.target;
            while (curr && curr.parent !== shadowRoots.elements && curr.parent instanceof Y.Map) {
              curr = curr.parent;
            }
            if (curr && curr.parent === shadowRoots.elements) {
              const id = curr.get('id');
              if (typeof id === 'string') {
                modifiedElementKeys.add(id);
              }
            }
          }
        }
      };
      shadowRoots.elements.observeDeep(elementsDeepObserver);

      try {
        const decoder = decoding.createDecoder(syncPayloadAfterMsgType);
        const dummyEncoder = encoding.createEncoder();
        syncProtocol.readSyncMessage(decoder, dummyEncoder, shadowDoc, 'validator');
      } finally {
        shadowRoots.meta.unobserveDeep(metaDeepObserver);
        shadowRoots.elements.unobserve(elementsObserver);
        shadowRoots.elements.unobserveDeep(elementsDeepObserver);
      }

      if (role !== Role.OWNER && metaModified) {
        return { valid: false, reason: SyncValidationFailureReason.META_FORBIDDEN };
      }

      if (shadowRoots.elements.size > LIMITS.MAX_ELEMENTS) {
        return { valid: false, reason: SyncValidationFailureReason.ELEMENT_QUOTA_EXCEEDED };
      }

      for (const key of modifiedElementKeys) {
        const elementMap = shadowRoots.elements.get(key);
        if (!elementMap) {
          continue;
        }
        if (!(elementMap instanceof Y.Map)) {
          return { valid: false, reason: SyncValidationFailureReason.INVALID_ELEMENT_SCHEMA };
        }
        const rawElement = elementMap.toJSON();
        const parsed = ElementDataSchema.safeParse(rawElement);
        if (!parsed.success) {
          return { valid: false, reason: SyncValidationFailureReason.INVALID_ELEMENT_SCHEMA };
        }
      }

      return { valid: true };
    } finally {
      if (shouldDestroy) {
        shadowDoc.destroy();
      }
    }
  }
}
