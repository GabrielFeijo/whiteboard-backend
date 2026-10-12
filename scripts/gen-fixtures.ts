/**
 * Gera fixtures/protocol/*.json a partir de src/shared (fonte da verdade).
 * Os mesmos arquivos são copiados para o frontend (`npm run sync:shared` lá)
 * e validados pelos testes de contrato nos dois repositórios.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as Y from 'yjs';
import {
  LIMITS,
  MSG,
  PROTOCOL_VERSION,
  SCHEMA_VERSION,
  SHARED_VERSION,
  WS_CLOSE,
  getDocRoots,
} from '../src/shared';

const out = join(__dirname, '..', 'fixtures', 'protocol');
mkdirSync(out, { recursive: true });

const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');
const write = (name: string, data: unknown) =>
  writeFileSync(join(out, name), JSON.stringify(data, null, 2) + '\n');

// Cada cliente usa clientID fixo para saída determinística.
function doc(clientID: number) {
  const d = new Y.Doc();
  d.clientID = clientID;
  return d;
}

function addRect(d: Y.Doc, id: string, x: number, y: number, createdBy: string) {
  const m = new Y.Map<unknown>();
  const style = new Y.Map<unknown>();
  d.transact(() => {
    getDocRoots(d).elements.set(id, m);
    m.set('id', id);
    m.set('type', 'rect');
    m.set('x', x);
    m.set('y', y);
    m.set('w', 100);
    m.set('h', 60);
    m.set('rotation', 0);
    m.set('z', 'a0');
    m.set('createdBy', createdBy);
    m.set('style', style);
    style.set('fill', '#ffffff');
    style.set('stroke', '#000000');
    style.set('strokeWidth', 2);
    style.set('opacity', 1);
  });
}

const snap = (d: Y.Doc) => getDocRoots(d).elements.toJSON();

// 1) constantes
write('constants.json', {
  SHARED_VERSION,
  SCHEMA_VERSION,
  PROTOCOL_VERSION,
  MSG,
  WS_CLOSE,
  LIMITS,
});

// 2) documento básico: um único update cria um retângulo
const a = doc(1001);
addRect(a, 'r1', 10, 20, 'u1');
write('doc-basic.json', {
  description: 'Um update cria o retângulo r1.',
  updates: [b64(Y.encodeStateAsUpdate(a))],
  expected: snap(a),
});

// 3) edição concorrente: A move (x,y), B muda cor (style.fill) do mesmo elemento
const base = doc(1001);
addRect(base, 'r1', 0, 0, 'u1');
const baseUpdate = Y.encodeStateAsUpdate(base);
const A = doc(2001);
const B = doc(3001);
Y.applyUpdate(A, baseUpdate);
Y.applyUpdate(B, baseUpdate);
const svA = Y.encodeStateVector(A);
const svB = Y.encodeStateVector(B);
A.transact(() => {
  const el = getDocRoots(A).elements.get('r1')!;
  el.set('x', 50);
  el.set('y', 70);
});
B.transact(() => {
  const el = getDocRoots(B).elements.get('r1')!;
  (el.get('style') as Y.Map<unknown>).set('fill', '#ff0000');
});
const updA = Y.encodeStateAsUpdate(A, svA);
const updB = Y.encodeStateAsUpdate(B, svB);
const merged = doc(9);
[baseUpdate, updA, updB].forEach((u) => Y.applyUpdate(merged, u));
write('doc-concurrent.json', {
  description: 'A move r1 e B pinta r1 ao mesmo tempo; ambas as edições são preservadas.',
  base: b64(baseUpdate),
  updatesAnyOrder: [b64(updA), b64(updB)],
  expected: snap(merged),
});

console.log('Fixtures geradas em', out);
