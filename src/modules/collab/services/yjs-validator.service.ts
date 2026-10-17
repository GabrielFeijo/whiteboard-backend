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
  ): SyncValidationResult {
    if (role === Role.VIEWER) {
      return { valid: false, reason: SyncValidationFailureReason.VIEWER_READ_ONLY };
    }

    const shadowDoc = new Y.Doc();
    try {
      const currentState = Y.encodeStateAsUpdate(currentDoc);
      Y.applyUpdate(shadowDoc, currentState);

      const currentRoots = getDocRoots(currentDoc);
      const beforeMetaJson = JSON.stringify(currentRoots.meta.toJSON());

      const decoder = decoding.createDecoder(syncPayloadAfterMsgType);
      const dummyEncoder = encoding.createEncoder();
      syncProtocol.readSyncMessage(decoder, dummyEncoder, shadowDoc, 'validator');

      const shadowRoots = getDocRoots(shadowDoc);

      if (role !== Role.OWNER && this.isMetaModified(beforeMetaJson, shadowRoots)) {
        return { valid: false, reason: SyncValidationFailureReason.META_FORBIDDEN };
      }

      if (shadowRoots.elements.size > LIMITS.MAX_ELEMENTS) {
        return { valid: false, reason: SyncValidationFailureReason.ELEMENT_QUOTA_EXCEEDED };
      }

      const elementsJson = shadowRoots.elements.toJSON() as Record<string, unknown>;
      if (!this.areAllElementsValid(elementsJson)) {
        return { valid: false, reason: SyncValidationFailureReason.INVALID_ELEMENT_SCHEMA };
      }

      return { valid: true };
    } finally {
      shadowDoc.destroy();
    }
  }

  private isMetaModified(beforeMetaJson: string, shadowRoots: { meta: Y.Map<unknown> }): boolean {
    const afterMetaJson = JSON.stringify(shadowRoots.meta.toJSON());
    return beforeMetaJson !== afterMetaJson;
  }

  private areAllElementsValid(elementsJson: Record<string, unknown>): boolean {
    for (const [, rawElement] of Object.entries(elementsJson)) {
      if (!rawElement || typeof rawElement !== 'object') {
        continue;
      }
      const parsed = ElementDataSchema.safeParse(rawElement);
      if (!parsed.success) {
        return false;
      }
    }
    return true;
  }
}
