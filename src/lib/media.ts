import { prisma } from './prisma';

/**
 * Finds and removes media assets that are not referenced by any content variant.
 * @param workspaceId Optional workspace ID to scope orphan cleanup.
 * @returns Number of orphaned media assets cleaned up.
 */
export async function cleanupOrphanMediaAssets(workspaceId?: string): Promise<{ deletedCount: number; deletedIds: string[] }> {
  const whereClause: any = {};
  if (workspaceId) {
    whereClause.workspaceId = workspaceId;
  }

  // Find media assets that have 0 ContentVariantMedia attachments
  const allAssets = await prisma.mediaAsset.findMany({
    where: whereClause,
    include: {
      contentVariants: true,
    },
  });

  const orphanIds = allAssets
    .filter((asset) => asset.contentVariants.length === 0)
    .map((asset) => asset.id);

  if (orphanIds.length === 0) {
    return { deletedCount: 0, deletedIds: [] };
  }

  const deleteResult = await prisma.mediaAsset.deleteMany({
    where: {
      id: { in: orphanIds },
    },
  });

  return {
    deletedCount: deleteResult.count,
    deletedIds: orphanIds,
  };
}
