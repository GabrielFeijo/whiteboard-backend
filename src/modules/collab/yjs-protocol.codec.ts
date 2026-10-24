import * as encoding from 'lib0/encoding';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { MSG } from '../../shared';

export function encodeSyncStep1(doc: Y.Doc): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MSG.SYNC);
  syncProtocol.writeSyncStep1(encoder, doc);
  return encoding.toUint8Array(encoder);
}

export function encodeSyncUpdate(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MSG.SYNC);
  syncProtocol.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
}

export function encodeFullStateSyncUpdate(doc: Y.Doc): Uint8Array {
  return encodeSyncUpdate(Y.encodeStateAsUpdate(doc));
}

export function encodeAwarenessMessage(
  awareness: awarenessProtocol.Awareness,
  clientIds: number[],
): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MSG.AWARENESS);
  encoding.writeVarUint8Array(
    encoder,
    awarenessProtocol.encodeAwarenessUpdate(awareness, clientIds),
  );
  return encoding.toUint8Array(encoder);
}

export function cloneYValue(value: unknown): unknown {
  if (value instanceof Y.Map) {
    const clonedMap = new Y.Map<unknown>();
    value.forEach((entryValue: unknown, key: string) => {
      clonedMap.set(key, cloneYValue(entryValue));
    });
    return clonedMap;
  }

  if (value instanceof Y.Array) {
    const clonedArray = new Y.Array<unknown>();
    const items = value.toArray().map((item: unknown) => cloneYValue(item));
    if (items.length > 0) {
      clonedArray.push(items);
    }
    return clonedArray;
  }

  if (Array.isArray(value)) {
    return value.map((item: unknown) => cloneYValue(item));
  }

  if (value !== null && typeof value === 'object') {
    const clonedObj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      clonedObj[k] = cloneYValue(v);
    }
    return clonedObj;
  }

  return value;
}
