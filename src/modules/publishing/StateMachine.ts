export type PublicationState =
  | 'DRAFT'
  | 'IN_REVIEW'
  | 'APPROVED'
  | 'SCHEDULED'
  | 'PUBLISHING'
  | 'PUBLISHED'
  | 'FAILED';

export type ContentState =
  | 'DRAFT'
  | 'IN_REVIEW'
  | 'APPROVED'
  | 'SCHEDULED'
  | 'PUBLISHING'
  | 'PUBLISHED'
  | 'PARTIALLY_PUBLISHED'
  | 'FAILED';

const VALID_PUBLICATION_TRANSITIONS: Record<PublicationState, PublicationState[]> = {
  DRAFT: ['IN_REVIEW', 'APPROVED', 'SCHEDULED'],
  IN_REVIEW: ['APPROVED', 'DRAFT'],
  APPROVED: ['SCHEDULED', 'DRAFT'],
  SCHEDULED: ['PUBLISHING', 'DRAFT', 'APPROVED'],
  PUBLISHING: ['PUBLISHED', 'FAILED'],
  FAILED: ['PUBLISHING', 'SCHEDULED', 'DRAFT'],
  PUBLISHED: [], // Terminal state for a specific publication run
};

export function isValidPublicationTransition(
  from: PublicationState | string,
  to: PublicationState | string
): boolean {
  const allowed = VALID_PUBLICATION_TRANSITIONS[from as PublicationState];
  if (!allowed) return false;
  return allowed.includes(to as PublicationState);
}

export function assertValidPublicationTransition(
  from: PublicationState | string,
  to: PublicationState | string
): void {
  if (!isValidPublicationTransition(from, to)) {
    throw new Error(`Invalid publication state transition from '${from}' to '${to}'.`);
  }
}

/**
  * Calculate parent Content status based on all child publications.
  */
export function calculateParentContentStatus(
  publicationStatuses: (PublicationState | string)[]
): ContentState {
  if (publicationStatuses.length === 0) {
    return 'DRAFT';
  }

  const publishedCount = publicationStatuses.filter((s) => s === 'PUBLISHED').length;
  const failedCount = publicationStatuses.filter((s) => s === 'FAILED').length;
  const publishingCount = publicationStatuses.filter((s) => s === 'PUBLISHING').length;
  const scheduledCount = publicationStatuses.filter((s) => s === 'SCHEDULED').length;

  if (publishedCount === publicationStatuses.length) {
    return 'PUBLISHED';
  }

  if (publishedCount > 0) {
    return 'PARTIALLY_PUBLISHED';
  }

  if (publishingCount > 0) {
    return 'PUBLISHING';
  }

  if (failedCount === publicationStatuses.length) {
    return 'FAILED';
  }

  if (scheduledCount > 0) {
    return 'SCHEDULED';
  }

  return 'DRAFT';
}
