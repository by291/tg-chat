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
          is_archived: boolean;
          is_hidden: boolean;
          is_manually_unread: boolean;
          keep_archived: boolean;
          /** @enum {string} */
          kind: 'preferences';
          /** Format: date-time */
          muted_until?: string | null;
          /** Format: int32 */
          pin_rank?: number | null;
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
    ConversationView: {
      clear_through: string;
      draft: components['schemas']['DraftView'];
      /** Format: int32 */
      expiry_days: number;
      generation: string;
      /** Format: uuid */
      id: string;
      is_archived: boolean;
      is_hidden: boolean;
      is_manually_unread: boolean;
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
      read_through: string;
      summary_text: string;
      unread_count: string;
      /** Format: date-time */
      updated_at: string;
      version: string;
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
      reply?: null | components['schemas']['ReplyInput'];
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
