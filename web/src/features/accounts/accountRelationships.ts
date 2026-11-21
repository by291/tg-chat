import type { components } from '@/api/schema';

export type RelationshipKind = 'contacts' | 'blocks';

export interface RelationshipChange {
  kind: RelationshipKind;
  id: string;
  shouldInclude: boolean;
}

export interface AccountRelationships {
  contacts: ReadonlySet<string>;
  blocks: ReadonlySet<string>;
}

/** Keep only relationship identities from the authorized directory bootstrap. */
export function bootstrapRelationships(bootstrap: components['schemas']['Bootstrap']) {
  return {
    contacts: new Set(bootstrap.contacts.map((profile) => profile.id)),
    blocks: new Set(bootstrap.blocks.map((profile) => profile.id)),
  };
}

/** Apply an admitted membership change without mutating a published snapshot. */
export function changedRelationships(
  current: AccountRelationships | undefined,
  change: RelationshipChange,
) {
  const previous = current ?? { contacts: new Set<string>(), blocks: new Set<string>() };
  const members = new Set(previous[change.kind]);
  if (change.shouldInclude) {
    members.add(change.id);
  } else {
    members.delete(change.id);
  }
  return { ...previous, [change.kind]: members };
}
