import { PrismaClient, Role } from '@prisma/client';
import * as argon2 from 'argon2';
import * as crypto from 'node:crypto';
import * as Y from 'yjs';
import { getDocRoots } from '../src/shared';

const prisma = new PrismaClient();

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function createDemoBoardYDoc(createdBy: string): Uint8Array {
  const doc = new Y.Doc();
  const roots = getDocRoots(doc);

  const addElement = (
    id: string,
    type: 'rect' | 'sticky' | 'arrow' | 'text',
    x: number,
    y: number,
    w: number,
    h: number,
    style: { fill: string; stroke: string; strokeWidth: number; opacity: number },
    text?: string,
  ) => {
    const el = new Y.Map<unknown>();
    const elStyle = new Y.Map<unknown>();

    elStyle.set('fill', style.fill);
    elStyle.set('stroke', style.stroke);
    elStyle.set('strokeWidth', style.strokeWidth);
    elStyle.set('opacity', style.opacity);

    el.set('id', id);
    el.set('type', type);
    el.set('x', x);
    el.set('y', y);
    el.set('w', w);
    el.set('h', h);
    el.set('rotation', 0);
    el.set('z', `z_${id}`);
    el.set('style', elStyle);
    el.set('createdBy', createdBy);
    if (text) {
      el.set('text', text);
    }

    roots.elements.set(id, el);
  };

  doc.transact(() => {
    addElement(
      'rect-api',
      'rect',
      100,
      120,
      220,
      80,
      { fill: '#e0f2fe', stroke: '#0284c7', strokeWidth: 2, opacity: 1 },
      'API Gateway (NestJS :3001)',
    );

    addElement(
      'rect-collab',
      'rect',
      420,
      120,
      240,
      80,
      { fill: '#fef3c7', stroke: '#d97706', strokeWidth: 2, opacity: 1 },
      'Collab Server (Yjs WS :3002)',
    );

    addElement(
      'rect-pg',
      'rect',
      100,
      280,
      220,
      80,
      { fill: '#dcfce7', stroke: '#16a34a', strokeWidth: 2, opacity: 1 },
      'PostgreSQL 16 (Prisma)',
    );

    addElement(
      'rect-redis',
      'rect',
      420,
      280,
      240,
      80,
      { fill: '#fee2e2', stroke: '#dc2626', strokeWidth: 2, opacity: 1 },
      'Redis 7 (Pub/Sub & Lockout)',
    );

    addElement(
      'note-welcome',
      'sticky',
      720,
      120,
      220,
      200,
      { fill: '#fef9c3', stroke: '#ca8a04', strokeWidth: 1, opacity: 1 },
      '🚀 Whiteboard Collaborative\n\nDual-entrypoint architecture with CRDT real-time sync, Redis ACL revocation, and S3 presigned uploads.',
    );
  }, 'seed');

  return Y.encodeStateAsUpdate(doc);
}

async function main(): Promise<void> {
  console.log('🌱 Starting database seeding...');

  const defaultPassword = 'Password123!';
  const passwordHash = await argon2.hash(defaultPassword, { type: argon2.argon2id });

  const alice = await prisma.user.upsert({
    where: { email: 'owner@whiteboard.local' },
    update: { name: 'Alice Owner', passwordHash, deletedAt: null },
    create: {
      email: 'owner@whiteboard.local',
      name: 'Alice Owner',
      passwordHash,
    },
  });

  const bob = await prisma.user.upsert({
    where: { email: 'editor@whiteboard.local' },
    update: { name: 'Bob Editor', passwordHash, deletedAt: null },
    create: {
      email: 'editor@whiteboard.local',
      name: 'Bob Editor',
      passwordHash,
    },
  });

  const charlie = await prisma.user.upsert({
    where: { email: 'viewer@whiteboard.local' },
    update: { name: 'Charlie Viewer', passwordHash, deletedAt: null },
    create: {
      email: 'viewer@whiteboard.local',
      name: 'Charlie Viewer',
      passwordHash,
    },
  });

  console.log('  ✅ Users seeded:');
  console.log(`     - Alice (Owner): ${alice.email}`);
  console.log(`     - Bob (Editor):   ${bob.email}`);
  console.log(`     - Charlie (Viewer): ${charlie.email}`);
  console.log(`     (Password for all: ${defaultPassword})`);

  let archBoard = await prisma.board.findFirst({
    where: { title: 'Distributed System Architecture', ownerId: alice.id, deletedAt: null },
  });

  if (!archBoard) {
    archBoard = await prisma.board.create({
      data: {
        title: 'Distributed System Architecture',
        ownerId: alice.id,
      },
    });
  }

  await prisma.boardMember.upsert({
    where: { boardId_userId: { boardId: archBoard.id, userId: alice.id } },
    update: { role: Role.OWNER },
    create: { boardId: archBoard.id, userId: alice.id, role: Role.OWNER },
  });

  await prisma.boardMember.upsert({
    where: { boardId_userId: { boardId: archBoard.id, userId: bob.id } },
    update: { role: Role.EDITOR },
    create: { boardId: archBoard.id, userId: bob.id, role: Role.EDITOR },
  });

  await prisma.boardMember.upsert({
    where: { boardId_userId: { boardId: archBoard.id, userId: charlie.id } },
    update: { role: Role.VIEWER },
    create: { boardId: archBoard.id, userId: charlie.id, role: Role.VIEWER },
  });

  const existingSnapshot = await prisma.snapshot.findFirst({
    where: { boardId: archBoard.id },
  });

  if (!existingSnapshot) {
    const yjsUpdate = createDemoBoardYDoc(alice.id);
    await prisma.snapshot.create({
      data: {
        boardId: archBoard.id,
        version: 1,
        reason: 'INITIAL_SEED',
        data: Buffer.from(yjsUpdate),
      },
    });
  }

  const editorShareToken = 'seed-editor-token-shared-access';
  const viewerShareToken = 'seed-viewer-token-public-readonly';

  await prisma.shareLink.upsert({
    where: { tokenHash: hashToken(editorShareToken) },
    update: { revokedAt: null, role: Role.EDITOR },
    create: {
      boardId: archBoard.id,
      tokenHash: hashToken(editorShareToken),
      role: Role.EDITOR,
    },
  });

  await prisma.shareLink.upsert({
    where: { tokenHash: hashToken(viewerShareToken) },
    update: { revokedAt: null, role: Role.VIEWER },
    create: {
      boardId: archBoard.id,
      tokenHash: hashToken(viewerShareToken),
      role: Role.VIEWER,
    },
  });

  let sprintBoard = await prisma.board.findFirst({
    where: { title: 'Sprint Planning & Backlog', ownerId: bob.id, deletedAt: null },
  });

  if (!sprintBoard) {
    sprintBoard = await prisma.board.create({
      data: {
        title: 'Sprint Planning & Backlog',
        ownerId: bob.id,
      },
    });
  }

  await prisma.boardMember.upsert({
    where: { boardId_userId: { boardId: sprintBoard.id, userId: bob.id } },
    update: { role: Role.OWNER },
    create: { boardId: sprintBoard.id, userId: bob.id, role: Role.OWNER },
  });

  await prisma.boardMember.upsert({
    where: { boardId_userId: { boardId: sprintBoard.id, userId: alice.id } },
    update: { role: Role.EDITOR },
    create: { boardId: sprintBoard.id, userId: alice.id, role: Role.EDITOR },
  });

  console.log('  ✅ Boards seeded:');
  console.log(`     - [${archBoard.id}] "${archBoard.title}" (Owner: Alice)`);
  console.log(`     - [${sprintBoard.id}] "${sprintBoard.title}" (Owner: Bob)`);
  console.log('  ✅ Share links seeded:');
  console.log(`     - Editor Token: ${editorShareToken}`);
  console.log(`     - Viewer Token: ${viewerShareToken}`);
  console.log('🎉 Database seeding completed successfully.');
}

main()
  .catch((err) => {
    console.error('❌ Database seeding failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
