// Generated from the Rust OpenAPI contract. Run pnpm api:generate.
export interface paths {
  '/api/v1/account/devices': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['devices'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/account/devices/revoke': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['revoke_device'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/account/devices/revoke-others': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['revoke_other_devices'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/account/email': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    delete: operations['remove'];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/account/email/verification': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['request_verification'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/account/password': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['change_password'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/account/privacy': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['privacy'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch: operations['update_privacy'];
    trace?: never;
  };
  '/api/v1/account/profile': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['profile'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch: operations['update_profile'];
    trace?: never;
  };
  '/api/v1/auth/email/confirm': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['confirm'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/auth/login': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['login'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/auth/logout': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['logout'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/auth/reauthenticate': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['reauthenticate'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/auth/recovery': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['request_recovery'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/auth/recovery/reset': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['reset_password'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/auth/register': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['register'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/auth/session': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['session'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/blocks': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['blocks'];
    put: operations['add_block'];
    post?: never;
    delete: operations['remove_block'];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/capabilities': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['capabilities'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/chat/bootstrap': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['bootstrap'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/chat/commands': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['command'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/chat/sync': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['sync'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/communities': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['community_discover'];
    put?: never;
    post: operations['community_create'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/communities/commands': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['community_command'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/communities/{conversation_id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['community_details'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/communities/{conversation_id}/invitations': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['community_invitations'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/communities/{conversation_id}/members': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['community_members'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/communities/{conversation_id}/requests': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['community_requests'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/community-invitations': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['community_inbox'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/community-invitations/preview': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['community_preview'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/contacts': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['contacts'];
    put: operations['add_contact'];
    post?: never;
    delete: operations['remove_contact'];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/conversations/{conversation_id}/history': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['history'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/messages': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['send'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/messages/{message_id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['message'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/users': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['discover'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/health/live': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['live'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/health/ready': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['ready'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
}
export type webhooks = Record<string, never>;
export interface components {
  schemas: {
    /** @enum {string} */
    Audience: 'everyone' | 'contacts' | 'nobody';
    AuthResponse: {
      csrf_token: string;
      session: components['schemas']['SessionView'];
      user: components['schemas']['PrivateProfile'];
    };
    Bootstrap: {
      blocks: components['schemas']['PublicProfile'][];
      contacts: components['schemas']['PublicProfile'][];
      conversations: components['schemas']['ConversationView'][];
      cursor: string;
      /** Format: uuid */
      deployment_id: string;
      privacy: components['schemas']['PrivacySettings'];
      user: components['schemas']['PrivateProfile'];
    };
    CanonicalMessage: {
      /** Format: uuid */
      author_id: string;
      author_name: string;
      content: components['schemas']['MessageContent'];
      /** Format: uuid */
      conversation_id: string;
      /** Format: date-time */
      created_at: string;
      /** Format: date-time */
      edited_at?: string | null;
      /** Format: date-time */
      expires_at?: string | null;
      /** Format: uuid */
      id: string;
      interaction_version: string;
      is_deleted: boolean;
      is_pinned: boolean;
      reactions: components['schemas']['ReactionView'][];
      reply?: null | components['schemas']['ReplyView'];
      sequence: string;
      service_kind?: string | null;
      version: string;
    };
    Capabilities: {
      avatars_available: boolean;
      email_recovery_available: boolean;
      messaging_available: boolean;
      registration_open: boolean;
    };
    CommandAction:
      | {
          content?: null | components['schemas']['MessageContent'];
          expected_version: string;
          /** @enum {string} */
          kind: 'draft';
          reply?: null | components['schemas']['ReplyInput'];
        }
      | {
          /** @enum {string} */
          kind: 'read';
          through: string;
        }
      | {
          change: components['schemas']['PreferenceChange'];
          /** @enum {string} */
          kind: 'preferences';
        }
      | {
          /** @enum {string} */
          kind: 'clear';
        }
      | {
          /** @enum {string} */
          kind: 'close';
        }
      | {
          /** Format: int32 */
          days: number;
          /** @enum {string} */
          kind: 'expiry';
        }
      | {
          content: components['schemas']['MessageContent'];
          expected_version: string;
          /** @enum {string} */
          kind: 'edit';
          /** Format: uuid */
          message_id: string;
        }
      | {
          /** @enum {string} */
          kind: 'delete';
          /** Format: uuid */
          message_id: string;
        }
      | {
          /** @enum {string} */
          kind: 'hide_message';
          /** Format: uuid */
          message_id: string;
        }
      | {
          emoji: string;
          is_selected: boolean;
          /** @enum {string} */
          kind: 'reaction';
          /** Format: uuid */
          message_id: string;
        }
      | {
          is_pinned: boolean;
          /** @enum {string} */
          kind: 'pin';
          /** Format: uuid */
          message_id: string;
        };
    CommandConflict: {
      current: components['schemas']['CommandReceipt'];
      error: components['schemas']['ErrorDetails'];
    };
    CommandReceipt: {
      conversation?: null | components['schemas']['ConversationView'];
      message?: null | components['schemas']['CanonicalMessage'];
      observation_cursor: string;
    };
    CommunityAction:
      | {
          /** Format: uuid */
          invitation_id?: string | null;
          /** @enum {string} */
          kind: 'join';
          token?: string | null;
        }
      | {
          /** Format: date-time */
          expires_at: string;
          /** Format: uuid */
          invitation_id: string;
          /** @enum {string} */
          kind: 'invite';
          /** Format: int64 */
          max_uses?: number | null;
          /** Format: uuid */
          target_id?: string | null;
          token?: string | null;
        }
      | {
          /** Format: uuid */
          invitation_id: string;
          /** @enum {string} */
          kind: 'revoke_invite';
        }
      | {
          /** @enum {string} */
          kind: 'approve';
          /** Format: uuid */
          user_id: string;
        }
      | {
          /** @enum {string} */
          kind: 'reject';
          /** Format: uuid */
          user_id: string;
        }
      | {
          /** @enum {string} */
          kind: 'leave';
        }
      | {
          expected_version: string;
          /** @enum {string} */
          kind: 'settings';
          settings: components['schemas']['CommunitySettings'];
        }
      | {
          /** @enum {string} */
          kind: 'role';
          role: string;
          /** Format: uuid */
          user_id: string;
        }
      | {
          /** @enum {string} */
          kind: 'transfer';
          /** Format: uuid */
          user_id: string;
        }
      | {
          /** @enum {string} */
          kind: 'remove';
          /** Format: uuid */
          user_id: string;
        }
      | {
          /** @enum {string} */
          kind: 'ban';
          /** Format: uuid */
          user_id: string;
        }
      | {
          /** @enum {string} */
          kind: 'unban';
          /** Format: uuid */
          user_id: string;
        }
      | {
          /** @enum {string} */
          kind: 'mute';
          /** Format: date-time */
          until?: string | null;
          /** Format: uuid */
          user_id: string;
        }
      | {
          /** @enum {string} */
          kind: 'delete';
        };
    CommunityCommand: {
      action: components['schemas']['CommunityAction'];
      /** Format: uuid */
      conversation_id: string;
      /** Format: uuid */
      operation_id: string;
    };
    CommunityMember: {
      display_name: string;
      /** Format: uuid */
      id: string;
      is_active: boolean;
      is_banned: boolean;
      /** Format: date-time */
      posting_muted_until?: string | null;
      role: string;
      username: string;
    };
    CommunityMemberPage: {
      items: components['schemas']['CommunityMember'][];
      /** Format: uuid */
      next?: string | null;
    };
    CommunityPage: {
      items: components['schemas']['CommunitySummary'][];
      /** Format: uuid */
      next?: string | null;
    };
    CommunitySettings: {
      description: string;
      is_public: boolean;
      public_handle?: string | null;
      requires_approval: boolean;
      title: string;
    };
    CommunitySummary: {
      description: string;
      /** Format: uuid */
      id: string;
      is_public: boolean;
      kind: string;
      member_count: string;
      public_handle?: string | null;
      requires_approval: boolean;
      title: string;
    };
    ConversationView: {
      can_manage: boolean;
      can_post: boolean;
      clear_through: string;
      description: string;
      draft: components['schemas']['DraftView'];
      /** Format: int32 */
      expiry_days: number;
      generation: string;
      /** Format: uuid */
      id: string;
      is_archived: boolean;
      is_hidden: boolean;
      is_manually_unread: boolean;
      is_public: boolean;
      keep_archived: boolean;
      kind: string;
      last_sequence: string;
      /** Format: date-time */
      muted_until?: string | null;
      /** Format: uuid */
      peer_id: string;
      peer_name: string;
      peer_read_through: string;
      peer_username: string;
      /** Format: int32 */
      pin_rank?: number | null;
      /** Format: date-time */
      posting_muted_until?: string | null;
      public_handle?: string | null;
      read_through: string;
      requires_approval: boolean;
      role: string;
      settings_version: string;
      /** Format: date-time */
      summary_expires_at?: string | null;
      summary_text: string;
      title: string;
      unread_count: string;
      /** Format: date-time */
      updated_at: string;
      version: string;
    };
    CreateCommunity: components['schemas']['CommunitySettings'] & {
      /** Format: uuid */
      conversation_id: string;
      kind: string;
      /** Format: uuid */
      operation_id: string;
    };
    CustomEmoji: {
      document_id: string;
      /** Format: int32 */
      length: number;
      /** Format: int32 */
      offset: number;
    };
    Destination:
      | {
          /** @enum {string} */
          kind: 'recipient';
          /** Format: uuid */
          user_id: string;
        }
      | {
          /** Format: uuid */
          conversation_id: string;
          /** @enum {string} */
          kind: 'conversation';
        }
      | {
          /** @enum {string} */
          kind: 'saved';
        };
    DeviceRevocation: {
      /** Format: uuid */
      session_id: string;
    };
    DirectoryPage: {
      next_cursor?: string | null;
      users: components['schemas']['PublicProfile'][];
    };
    DraftView: {
      content?: null | components['schemas']['MessageContent'];
      is_reply_unavailable?: boolean | null;
      reply?: null | components['schemas']['ReplyInput'];
      /** Format: date-time */
      reply_expires_at?: string | null;
      version: string;
    };
    EmailAddress: {
      email: string;
    };
    EmailConfirmation: {
      token: string;
    };
    ErrorDetails: {
      code: string;
      message: string;
      request_id: string;
    };
    ErrorResponse: {
      error: components['schemas']['ErrorDetails'];
    };
    HealthResponse: {
      service: components['schemas']['ServiceKind'];
      status: components['schemas']['HealthStatus'];
    };
    /** @enum {string} */
    HealthStatus: 'ok';
    HistoryPage: {
      generation: string;
      has_newer: boolean;
      has_older: boolean;
      messages: components['schemas']['CanonicalMessage'][];
      observation_cursor: string;
      preceding_message?: null | components['schemas']['CanonicalMessage'];
    };
    InvitationPage: {
      items: components['schemas']['InvitationView'][];
      /** Format: uuid */
      next?: string | null;
    };
    InvitationView: {
      /** Format: uuid */
      conversation_id: string;
      /** Format: date-time */
      expires_at: string;
      /** Format: uuid */
      id: string;
      /** Format: int64 */
      max_uses?: number | null;
      /** Format: date-time */
      revoked_at?: string | null;
      /** Format: uuid */
      target_id?: string | null;
      title: string;
      /** Format: int64 */
      uses: number;
    };
    InvitePreview: {
      /** Format: uuid */
      id: string;
      kind: string;
      requires_approval: boolean;
      title: string;
    };
    InvitePreviewInput: {
      token: string;
    };
    JoinRequestPage: {
      items: components['schemas']['JoinRequestView'][];
      /** Format: uuid */
      next?: string | null;
    };
    JoinRequestView: {
      /** Format: date-time */
      created_at: string;
      display_name: string;
      /** Format: uuid */
      id: string;
      username: string;
    };
    Login: {
      device_name: string;
      password: string;
      username: string;
    };
    MessageCommand: {
      action: components['schemas']['CommandAction'];
      /** Format: uuid */
      conversation_id: string;
      /** Format: uuid */
      operation_id: string;
    };
    MessageContent: {
      custom_emoji: components['schemas']['CustomEmoji'][];
      rich_text?: string | null;
      /** Format: int32 */
      schema_version: number;
      text: string;
    };
    PasswordProof: {
      password: string;
    };
    PasswordReplacement: {
      current_password: string;
      new_password: string;
    };
    PasswordReset: {
      new_password: string;
      token: string;
    };
    PreferenceChange:
      | {
          /** @enum {string} */
          field: 'archive';
          is_archived: boolean;
        }
      | {
          /** @enum {string} */
          field: 'hidden';
          is_hidden: boolean;
        }
      | {
          /** @enum {string} */
          field: 'unread';
          is_manually_unread: boolean;
        }
      | {
          /** @enum {string} */
          field: 'pin';
          /** Format: int32 */
          rank?: number | null;
        }
      | {
          /** @enum {string} */
          field: 'mute';
          /** Format: date-time */
          until?: string | null;
        }
      | {
          /** @enum {string} */
          field: 'archive_retention';
          keep_archived: boolean;
        };
    PrivacySettings: {
      calls: components['schemas']['Audience'];
      direct_messages: components['schemas']['Audience'];
      presence: components['schemas']['Audience'];
    };
    PrivateProfile: {
      biography: string;
      display_name: string;
      email?: string | null;
      /** Format: uuid */
      id: string;
      is_operator: boolean;
      phone?: string | null;
      username: string;
      version: string;
    };
    ProfileUpdate: {
      biography: string;
      display_name: string;
      phone?: string | null;
      version: string;
    };
    PublicProfile: {
      biography: string;
      display_name: string;
      /** Format: uuid */
      id: string;
      username: string;
    };
    ReactionView: {
      count: string;
      emoji: string;
      is_selected: boolean;
    };
    Registration: {
      device_name: string;
      display_name: string;
      password: string;
      username: string;
    };
    RelationshipTarget: {
      /** Format: uuid */
      target_id: string;
    };
    ReplyInput: {
      /** Format: uuid */
      message_id: string;
      quote?: string | null;
    };
    ReplyView: {
      /** Format: date-time */
      expires_at?: string | null;
      is_unavailable: boolean;
      /** Format: uuid */
      message_id: string;
      quote?: string | null;
    };
    SendMessage: {
      content: components['schemas']['MessageContent'];
      destination: components['schemas']['Destination'];
      draft_version?: string | null;
      /** Format: uuid */
      message_id: string;
      /** Format: uuid */
      operation_id: string;
      reply?: null | components['schemas']['ReplyInput'];
    };
    SendReceipt: {
      conversation: components['schemas']['ConversationView'];
      message: components['schemas']['CanonicalMessage'];
      observation_cursor: string;
    };
    /** @enum {string} */
    ServiceKind: 'api' | 'worker';
    SessionView: {
      /** Format: date-time */
      created_at: string;
      device_name: string;
      /** Format: date-time */
      expires_at: string;
      /** Format: uuid */
      id: string;
      is_current: boolean;
      /** Format: date-time */
      last_seen_at: string;
    };
    SyncGroup: {
      conversation?: null | components['schemas']['ConversationView'];
      /** Format: uuid */
      conversation_id: string;
      message?: null | components['schemas']['CanonicalMessage'];
      position: string;
      /** Format: uuid */
      removed_message_id?: string | null;
    };
    SyncPage: {
      cursor: string;
      groups: components['schemas']['SyncGroup'][];
      has_more: boolean;
      observation_cursor: string;
    };
  };
  responses: never;
  parameters: never;
  requestBodies: never;
  headers: never;
  pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
  devices: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['SessionView'][];
        };
      };
    };
  };
  revoke_device: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['DeviceRevocation'];
      };
    };
    responses: {
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  revoke_other_devices: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  remove: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  request_verification: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['EmailAddress'];
      };
    };
    responses: {
      202: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  change_password: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['PasswordReplacement'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['AuthResponse'];
        };
      };
    };
  };
  privacy: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['PrivacySettings'];
        };
      };
    };
  };
  update_privacy: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['PrivacySettings'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['PrivacySettings'];
        };
      };
    };
  };
  profile: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['PrivateProfile'];
        };
      };
    };
  };
  update_profile: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['ProfileUpdate'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['PrivateProfile'];
        };
      };
    };
  };
  confirm: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['EmailConfirmation'];
      };
    };
    responses: {
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  login: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['Login'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['AuthResponse'];
        };
      };
    };
  };
  logout: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  reauthenticate: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['PasswordProof'];
      };
    };
    responses: {
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  request_recovery: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['EmailAddress'];
      };
    };
    responses: {
      202: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  reset_password: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['PasswordReset'];
      };
    };
    responses: {
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  register: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['Registration'];
      };
    };
    responses: {
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['AuthResponse'];
        };
      };
    };
  };
  session: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['AuthResponse'];
        };
      };
    };
  };
  blocks: {
    parameters: {
      query?: {
        search?: string;
        cursor?: string;
        limit?: number;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['DirectoryPage'];
        };
      };
    };
  };
  add_block: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['RelationshipTarget'];
      };
    };
    responses: {
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  remove_block: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['RelationshipTarget'];
      };
    };
    responses: {
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  capabilities: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Capabilities'];
        };
      };
    };
  };
  bootstrap: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['Bootstrap'];
        };
      };
    };
  };
  command: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['MessageCommand'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['CommandReceipt'];
        };
      };
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['CommandConflict'];
        };
      };
    };
  };
  sync: {
    parameters: {
      query: {
        cursor: string;
        limit?: number;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['SyncPage'];
        };
      };
    };
  };
  community_discover: {
    parameters: {
      query?: {
        after?: string;
        limit?: number;
        search?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['CommunityPage'];
        };
      };
    };
  };
  community_create: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['CreateCommunity'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['CommandReceipt'];
        };
      };
    };
  };
  community_command: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['CommunityCommand'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['CommandReceipt'];
        };
      };
    };
  };
  community_details: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        conversation_id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ConversationView'];
        };
      };
    };
  };
  community_invitations: {
    parameters: {
      query?: {
        after?: string;
        limit?: number;
        search?: string;
      };
      header?: never;
      path: {
        conversation_id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['InvitationPage'];
        };
      };
    };
  };
  community_members: {
    parameters: {
      query?: {
        after?: string;
        limit?: number;
        search?: string;
      };
      header?: never;
      path: {
        conversation_id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['CommunityMemberPage'];
        };
      };
    };
  };
  community_requests: {
    parameters: {
      query?: {
        after?: string;
        limit?: number;
        search?: string;
      };
      header?: never;
      path: {
        conversation_id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['JoinRequestPage'];
        };
      };
    };
  };
  community_inbox: {
    parameters: {
      query?: {
        after?: string;
        limit?: number;
        search?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['InvitationPage'];
        };
      };
    };
  };
  community_preview: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['InvitePreviewInput'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['InvitePreview'];
        };
      };
    };
  };
  contacts: {
    parameters: {
      query?: {
        search?: string;
        cursor?: string;
        limit?: number;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['DirectoryPage'];
        };
      };
    };
  };
  add_contact: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['RelationshipTarget'];
      };
    };
    responses: {
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  remove_contact: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['RelationshipTarget'];
      };
    };
    responses: {
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  history: {
    parameters: {
      query?: {
        before?: string;
        after?: string;
        limit?: number;
        around?: string;
        pinned?: boolean;
      };
      header?: never;
      path: {
        conversation_id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HistoryPage'];
        };
      };
    };
  };
  send: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['SendMessage'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['SendReceipt'];
        };
      };
    };
  };
  message: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        message_id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['CanonicalMessage'];
        };
      };
    };
  };
  discover: {
    parameters: {
      query?: {
        search?: string;
        cursor?: string;
        limit?: number;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['DirectoryPage'];
        };
      };
    };
  };
  live: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Process is running */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HealthResponse'];
        };
      };
    };
  };
  ready: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Database and schema are ready */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['HealthResponse'];
        };
      };
      /** @description Required dependency is unavailable */
      503: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ErrorResponse'];
        };
      };
    };
  };
}
