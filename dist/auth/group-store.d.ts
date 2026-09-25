import type { AuthGroup } from './rbac-types.js';
export declare const groupStore: {
    list(tenantId?: string): Promise<AuthGroup[]>;
    findById(id: string, tenantId?: string): Promise<AuthGroup | null>;
    create(input: {
        tenantId?: string;
        name: string;
        description?: string;
        roleIds?: string[];
    }): Promise<AuthGroup>;
    update(id: string, input: {
        name?: string;
        description?: string;
        roleIds?: string[];
    }, tenantId?: string): Promise<AuthGroup | null>;
    delete(id: string, tenantId?: string): Promise<boolean>;
    addMember(groupId: string, userId: string, addedBy?: string | null): Promise<void>;
    removeMember(groupId: string, userId: string): Promise<void>;
    setMembers(groupId: string, userIds: string[], addedBy?: string | null): Promise<void>;
    membersOf(groupId: string): Promise<string[]>;
    /** Replace all of a user's group memberships with the given group id list. */
    setGroupsForUser(userId: string, groupIds: string[], addedBy?: string | null): Promise<void>;
    groupsForUser(userId: string): Promise<AuthGroup[]>;
    rolesForUserViaGroups(userId: string): Promise<string[]>;
};
//# sourceMappingURL=group-store.d.ts.map