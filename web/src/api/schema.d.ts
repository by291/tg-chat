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
  '/api/v1/account/profile/avatar': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put: operations['set_profile_avatar'];
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
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
  '/api/v1/chat/search': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['search'];
    put?: never;
    post?: never;
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
  '/api/v1/media/avatars/{owner_kind}/{owner_id}/{variant}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['download_avatar'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/media/messages/{message_id}/attachments/{occurrence_id}/{variant}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['download_message'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/media/uploads': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['reserve'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/media/uploads/{upload_id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['status'];
    put?: never;
    post?: never;
    delete: operations['cancel'];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/media/uploads/{upload_id}/complete': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['complete'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/media/uploads/{upload_id}/preview/{variant}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['preview_upload'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/media/uploads/{upload_id}/transfer': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['transfer'];
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
  '/api/v1/messages/forward': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['forward'];
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
  '/api/v1/messages/{message_id}/poll/voters': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['poll_voters'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/messages/{message_id}/reports': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['report_message'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/operator/accounts': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['operator_accounts'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/operator/cases': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['cases'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/operator/cases/{case_id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['case_detail'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/operator/cases/{case_id}/attachments/{occurrence_id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['case_original'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/operator/commands': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations['operator_command'];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/operator/communities': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['operator_communities'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/operator/jobs': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['operator_jobs'];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  '/api/v1/operator/storage/{user_id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['storage'];
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
  '/api/v1/users/{user_id}': {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations['directory_profile'];
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
    AttachmentInput: {
      /** Format: uuid */
      file_id: string;
      /** Format: uuid */
      occurrence_id: string;
    };
    AttachmentView: {
      file: components['schemas']['MediaFileView'];
      file_name: string;
      /** Format: uuid */
      occurrence_id: string;
    };
    /** @enum {string} */
    Audience: 'everyone' | 'contacts' | 'nobody';
    AuthResponse: {
      csrf_token: string;
      session: components['schemas']['SessionView'];
      user: components['schemas']['PrivateProfile'];
    };
    /** @enum {string} */
    AvatarOwner: 'user' | 'conversation';
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
      attachments?: components['schemas']['AttachmentView'][];
      /** Format: uuid */
      author_id: string;
      author_name: string;
      body?: null | components['schemas']['MessageBodyView'];
      content: components['schemas']['MessageContent'];
      /** Format: uuid */
      conversation_id: string;
      /** Format: date-time */
      created_at: string;
      disable_link_preview?: boolean | null;
      /** Format: date-time */
      edited_at?: string | null;
      /** Format: date-time */
      expires_at?: string | null;
      forwarded_from?: string | null;
      /** Format: uuid */
      id: string;
      interaction_version: string;
      is_deleted: boolean;
      is_pinned: boolean;
      link_preview?: null | components['schemas']['LinkPreviewView'];
      reactions: components['schemas']['ReactionView'][];
      reply?: null | components['schemas']['ReplyView'];
      sequence: string;
      service_kind?: string | null;
      version: string;
    };
    Capabilities: {
      avatars_available: boolean;
      email_recovery_available: boolean;
      media_uploads_available?: boolean | null;
      messaging_available: boolean;
      registration_open: boolean;
    };
    CaseAttachment: {
      file_name: string;
      /** Format: uuid */
      occurrence_id: string;
      /** Format: int64 */
      size_bytes: number;
    };
    CaseDetail: {
      attachments: components['schemas']['CaseAttachment'][];
      case: components['schemas']['CaseSummary'];
      evidence?: null | components['schemas']['CaseEvidence'];
    };
    CaseEvidence: {
      message_text: string;
      message_version: string;
      reporter_note: string;
      structured_body?: unknown;
    };
    CasePage: {
      items: components['schemas']['CaseSummary'][];
      /** Format: uuid */
      next?: string | null;
    };
    CaseSummary: {
      /** Format: uuid */
      conversation_id: string;
      /** Format: date-time */
      created_at: string;
      /** Format: date-time */
      evidence_expires_at: string;
      /** Format: uuid */
      id: string;
      /** Format: uuid */
      message_id: string;
      reason: string;
      /** Format: uuid */
      reported_author_id: string;
      /** Format: uuid */
      reporter_id: string;
      /** Format: date-time */
      resolved_at?: string | null;
    };
    ChecklistCompleter: {
      display_name: string;
      /** Format: uuid */
      user_id: string;
    };
    ChecklistInput: {
      can_others_append?: boolean;
      can_others_complete?: boolean;
      tasks: components['schemas']['ChecklistTaskInput'][];
      title: string;
    };
    ChecklistSnapshotTask: {
      /** Format: uuid */
      id: string;
      is_complete: boolean;
      text: string;
    };
    ChecklistTaskInput: {
      /** Format: uuid */
      id: string;
      text: string;
    };
    ChecklistTaskView: {
      completed_by?: null | components['schemas']['ChecklistCompleter'];
      /** Format: uuid */
      id: string;
      is_complete: boolean;
      text: string;
      version: string;
    };
    ChecklistView: {
      can_append: boolean;
      can_complete: boolean;
      can_edit: boolean;
      can_others_append: boolean;
      can_others_complete: boolean;
      list_version: string;
      tasks: components['schemas']['ChecklistTaskView'][];
      title: string;
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
          disable_link_preview?: boolean | null;
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
        }
      | {
          /** @enum {string} */
          kind: 'vote_poll';
          /** Format: uuid */
          message_id: string;
          option_ids: string[];
        }
      | {
          expected_poll_version: string;
          /** @enum {string} */
          kind: 'edit_poll';
          /** Format: uuid */
          message_id: string;
          poll: components['schemas']['PollInput'];
          preserve_quiz?: boolean | null;
        }
      | {
          expected_poll_version: string;
          /** @enum {string} */
          kind: 'add_poll_option';
          /** Format: uuid */
          message_id: string;
          option: components['schemas']['PollOptionInput'];
        }
      | {
          /** @enum {string} */
          kind: 'close_poll';
          /** Format: uuid */
          message_id: string;
        }
      | {
          is_enabled: boolean;
          /** @enum {string} */
          kind: 'set_forwarding_policy';
        }
      | {
          /** @enum {string} */
          kind: 'batch_hide';
          message_ids: string[];
        }
      | {
          /** @enum {string} */
          kind: 'batch_delete';
          message_ids: string[];
        }
      | {
          expected_task_version: string;
          is_complete: boolean;
          /** @enum {string} */
          kind: 'set_checklist_task';
          /** Format: uuid */
          message_id: string;
          /** Format: uuid */
          task_id: string;
        }
      | {
          expected_list_version: string;
          /** @enum {string} */
          kind: 'append_checklist_tasks';
          /** Format: uuid */
          message_id: string;
          tasks: components['schemas']['ChecklistTaskInput'][];
        }
      | {
          checklist: components['schemas']['ChecklistInput'];
          expected_list_version: string;
          /** @enum {string} */
          kind: 'edit_checklist';
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
          expected_version: string;
          /** Format: uuid */
          file_id?: string | null;
          /** @enum {string} */
          kind: 'avatar';
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
      /** Format: uuid */
      avatar_file_id?: string | null;
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
      /** Format: uuid */
      avatar_file_id?: string | null;
      can_manage: boolean;
      can_post: boolean;
      can_set_forwarding_policy: boolean;
      clear_through: string;
      description: string;
      draft: components['schemas']['DraftView'];
      /** Format: int32 */
      expiry_days: number;
      generation: string;
      has_forwarding_consent: boolean;
      /** Format: uuid */
      id: string;
      is_archived: boolean;
      is_forwarding_enabled: boolean;
      is_hidden: boolean;
      is_manually_unread: boolean;
      is_public: boolean;
      keep_archived: boolean;
      kind: string;
      last_sequence: string;
      /** Format: date-time */
      muted_until?: string | null;
      /** Format: uuid */
      peer_avatar_file_id?: string | null;
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
    ForwardBatch: {
      destination: components['schemas']['Destination'];
      items: components['schemas']['ForwardItem'][];
      /** Format: uuid */
      operation_id: string;
    };
    ForwardItem: {
      /** Format: uuid */
      message_id: string;
      /** Format: uuid */
      source_message_id: string;
    };
    ForwardReceipt: {
      conversation?: null | components['schemas']['ConversationView'];
      message_ids: string[];
      messages: components['schemas']['CanonicalMessage'][];
      observation_cursor: string;
    };
    HealthResponse: {
      service: components['schemas']['ServiceKind'];
      status: components['schemas']['HealthStatus'];
    };
    /** @enum {string} */
    HealthStatus: 'ok';
    HistoryPage: {
      /** Format: uuid */
      anchor_id?: string | null;
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
    LinkPreviewView: {
      site_name: string;
      summary: string;
      title: string;
      url: string;
    };
    Login: {
      device_name: string;
      password: string;
      username: string;
    };
    MediaFileView: {
      /** Format: int64 */
      duration_ms?: number | null;
      /** Format: uuid */
      file_id: string;
      /** Format: int32 */
      height?: number | null;
      kind: components['schemas']['UploadPurpose'];
      /** Format: int64 */
      size_bytes: number;
      variants: components['schemas']['MediaVariant'][];
      waveform?: number[] | null;
      /** Format: int32 */
      width?: number | null;
    };
    /** @enum {string} */
    MediaVariant: 'original' | 'thumbnail' | 'poster' | 'playback';
    MessageBodyInput:
      | (components['schemas']['PollInput'] & {
          /** @enum {string} */
          kind: 'poll';
        })
      | (components['schemas']['ChecklistInput'] & {
          /** @enum {string} */
          kind: 'checklist';
        })
      | {
          /** @enum {string} */
          kind: 'sticker';
          sticker_id: string;
        }
      | {
          /** Format: uuid */
          account_id?: string | null;
          display_name: string;
          /** @enum {string} */
          kind: 'contact';
          phone?: string | null;
        };
    MessageBodyView:
      | (components['schemas']['PollView'] & {
          /** @enum {string} */
          kind: 'poll';
        })
      | (components['schemas']['ChecklistView'] & {
          /** @enum {string} */
          kind: 'checklist';
        })
      | {
          /** @enum {string} */
          kind: 'poll_snapshot';
          options: components['schemas']['PollOptionInput'][];
          question: string;
        }
      | {
          /** @enum {string} */
          kind: 'checklist_snapshot';
          tasks: components['schemas']['ChecklistSnapshotTask'][];
          title: string;
        }
      | {
          /** @enum {string} */
          kind: 'sticker';
          sticker_id: string;
        }
      | {
          /** Format: uuid */
          account_id?: string | null;
          display_name: string;
          /** @enum {string} */
          kind: 'contact';
          phone?: string | null;
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
    /** @enum {string} */
    MessageKind:
      | 'photo'
      | 'video'
      | 'photo_video'
      | 'file'
      | 'voice'
      | 'link'
      | 'text'
      | 'sticker'
      | 'contact'
      | 'poll'
      | 'checklist'
      | 'service';
    OperatorAccount: {
      display_name: string;
      /** Format: uuid */
      id: string;
      is_suspended: boolean;
      username: string;
    };
    OperatorAction:
      | {
          is_open: boolean;
          /** @enum {string} */
          kind: 'set_registration';
        }
      | {
          is_suspended: boolean;
          /** @enum {string} */
          kind: 'set_suspension';
          /** Format: uuid */
          user_id: string;
        }
      | {
          /** Format: uuid */
          case_id: string;
          /** @enum {string} */
          kind: 'resolve_case';
        }
      | {
          /** Format: uuid */
          case_id: string;
          /** Format: date-time */
          deadline: string;
          /** @enum {string} */
          kind: 'extend_evidence';
        }
      | {
          is_quarantined: boolean;
          /** @enum {string} */
          kind: 'set_quarantine';
          target: components['schemas']['QuarantineTarget'];
        }
      | {
          /** @enum {string} */
          kind: 'set_account_storage_limit';
          limit_bytes?: string | null;
          /** Format: uuid */
          user_id: string;
        }
      | {
          /** Format: uuid */
          job_id: string;
          job_kind: components['schemas']['OperatorJobKind'];
          /** @enum {string} */
          kind: 'retry_job';
        };
    OperatorCommand: {
      action: components['schemas']['OperatorAction'];
      /** Format: uuid */
      operation_id: string;
      reason: string;
    };
    OperatorCommunity: {
      /** Format: uuid */
      id: string;
      is_quarantined: boolean;
      kind: string;
      title: string;
    };
    OperatorJob: {
      /** Format: int32 */
      attempts: number;
      can_retry: boolean;
      failure_code: string;
      /** Format: uuid */
      id: string;
      /** Format: date-time */
      recorded_at: string;
      status: string;
    };
    /** @enum {string} */
    OperatorJobKind: 'mail' | 'sync_wakeup' | 'media';
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
    PollInput: {
      can_add_options?: boolean;
      can_revote?: boolean;
      /** Format: date-time */
      closes_at?: string | null;
      description?: string | null;
      hide_results_until_close?: boolean;
      is_anonymous: boolean;
      is_multiple_choice?: boolean;
      options: components['schemas']['PollOptionInput'][];
      question: string;
      quiz?: null | components['schemas']['QuizInput'];
    };
    PollOptionInput: {
      /** Format: uuid */
      id: string;
      text: string;
    };
    PollOptionView: {
      /** Format: uuid */
      id: string;
      text: string;
      /** Format: int64 */
      votes?: number | null;
    };
    PollView: {
      can_add_options: boolean;
      can_close: boolean;
      can_edit: boolean;
      can_revote: boolean;
      can_vote: boolean;
      /** Format: date-time */
      closes_at?: string | null;
      correct_option_ids?: string[] | null;
      description?: string | null;
      explanation?: string | null;
      hide_results_until_close: boolean;
      is_anonymous: boolean;
      is_closed: boolean;
      is_multiple_choice: boolean;
      is_quiz: boolean;
      options: components['schemas']['PollOptionView'][];
      question: string;
      selected_option_ids: string[];
      version: string;
      /** Format: int64 */
      voter_count?: number | null;
    };
    PollVoter: {
      display_name: string;
      /** Format: uuid */
      user_id: string;
    };
    PollVoterPage: {
      /** Format: uuid */
      next_after?: string | null;
      voters: components['schemas']['PollVoter'][];
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
      /** Format: uuid */
      avatar_file_id?: string | null;
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
      /** Format: uuid */
      avatar_file_id?: string | null;
      biography: string;
      display_name: string;
      /** Format: uuid */
      id: string;
      username: string;
    };
    QuarantineTarget:
      | {
          /** Format: uuid */
          case_id: string;
          /** @enum {string} */
          kind: 'case';
        }
      | {
          /** Format: uuid */
          conversation_id: string;
          /** @enum {string} */
          kind: 'community';
        };
    QuizInput: {
      correct_option_ids: string[];
      explanation?: string | null;
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
    ReportMessage: {
      note?: string | null;
      /** Format: uuid */
      operation_id: string;
      reason: components['schemas']['ReportReason'];
    };
    /** @enum {string} */
    ReportReason: 'spam' | 'harassment' | 'harmful_content' | 'other';
    ReportReceipt: {
      /** Format: uuid */
      case_id: string;
      /** Format: date-time */
      evidence_expires_at: string;
    };
    ReserveUpload: {
      file_name: string;
      purpose: components['schemas']['UploadPurpose'];
      sha256: string;
      /** Format: int64 */
      size_bytes: number;
      /** Format: uuid */
      upload_id: string;
    };
    SearchPage: {
      /** Format: date-time */
      date_from?: string | null;
      /** Format: date-time */
      date_to?: string | null;
      hits: components['schemas']['CanonicalMessage'][];
      is_truncated: boolean;
      next_cursor?: string | null;
      observation_cursor: string;
    };
    SendMessage: {
      attachments?: components['schemas']['AttachmentInput'][];
      body?: null | components['schemas']['MessageBodyInput'];
      content: components['schemas']['MessageContent'];
      destination: components['schemas']['Destination'];
      disable_link_preview?: boolean | null;
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
    SetAvatar: {
      expected_version: string;
      /** Format: uuid */
      file_id?: string | null;
      /** Format: uuid */
      operation_id: string;
    };
    SignedDownload: {
      /** Format: date-time */
      expires_at: string;
      url: string;
    };
    SignedUpload: {
      /** Format: date-time */
      expires_at: string;
      headers: {
        [key: string]: string;
      };
      /** Format: int32 */
      part_number?: number | null;
      url: string;
    };
    StorageUsage: {
      account_bytes: string;
      account_limit_bytes: string;
      original_bytes: string;
      original_limit_bytes: string;
      staging_bytes: string;
      staging_limit_bytes: string;
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
    /** @enum {string} */
    TransferMode: 'single_put' | 'multipart';
    TransferPlan: {
      confirmed_parts: number[];
      requests: components['schemas']['SignedUpload'][];
      single_put_complete: boolean;
    };
    TransferRequest: {
      part_numbers?: number[];
    };
    /** @enum {string} */
    UploadPurpose: 'image' | 'video' | 'document' | 'voice' | 'avatar';
    /** @enum {string} */
    UploadState:
      'reserved' | 'uploaded' | 'processing' | 'ready' | 'rejected' | 'cancelled' | 'expired';
    UploadStatus: {
      error_code?: string | null;
      /** Format: date-time */
      expires_at: string;
      /** Format: uuid */
      file_id?: string | null;
      /** Format: int64 */
      part_size_bytes?: number | null;
      state: components['schemas']['UploadState'];
      transfer_mode: components['schemas']['TransferMode'];
      /** Format: uuid */
      upload_id: string;
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
  set_profile_avatar: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['SetAvatar'];
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
  search: {
    parameters: {
      query?: {
        query?: string;
        conversation_id?: string;
        sender_id?: string;
        date_from?: string;
        date_to?: string;
        kind?: components['schemas']['MessageKind'];
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
          'application/json': components['schemas']['SearchPage'];
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
        kind?: components['schemas']['MessageKind'];
        date_at?: string;
        date_from?: string;
        date_to?: string;
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
  download_avatar: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        owner_kind: components['schemas']['AvatarOwner'];
        owner_id: string;
        variant: components['schemas']['MediaVariant'];
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
          'application/json': components['schemas']['SignedDownload'];
        };
      };
    };
  };
  download_message: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        message_id: string;
        occurrence_id: string;
        variant: components['schemas']['MediaVariant'];
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
          'application/json': components['schemas']['SignedDownload'];
        };
      };
    };
  };
  reserve: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['ReserveUpload'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['UploadStatus'];
        };
      };
    };
  };
  status: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        upload_id: string;
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
          'application/json': components['schemas']['UploadStatus'];
        };
      };
    };
  };
  cancel: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        upload_id: string;
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
          'application/json': components['schemas']['UploadStatus'];
        };
      };
    };
  };
  complete: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        upload_id: string;
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
          'application/json': components['schemas']['UploadStatus'];
        };
      };
    };
  };
  preview_upload: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        upload_id: string;
        variant: components['schemas']['MediaVariant'];
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
          'application/json': components['schemas']['SignedDownload'];
        };
      };
    };
  };
  transfer: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        upload_id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['TransferRequest'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['TransferPlan'];
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
  forward: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['ForwardBatch'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ForwardReceipt'];
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
  poll_voters: {
    parameters: {
      query?: {
        option_id?: string;
        after?: string;
      };
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
          'application/json': components['schemas']['PollVoterPage'];
        };
      };
    };
  };
  report_message: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        message_id: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['ReportMessage'];
      };
    };
    responses: {
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ReportReceipt'];
        };
      };
    };
  };
  operator_accounts: {
    parameters: {
      query?: {
        search?: string;
        after?: string;
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
          'application/json': components['schemas']['OperatorAccount'][];
        };
      };
    };
  };
  cases: {
    parameters: {
      query?: {
        after?: string;
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
          'application/json': components['schemas']['CasePage'];
        };
      };
    };
  };
  case_detail: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        case_id: string;
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
          'application/json': components['schemas']['CaseDetail'];
        };
      };
    };
  };
  case_original: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        case_id: string;
        occurrence_id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Private original attachment stream */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  operator_command: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        'application/json': components['schemas']['OperatorCommand'];
      };
    };
    responses: {
      /** @description Operator command committed or already applied */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      400: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ErrorResponse'];
        };
      };
      401: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ErrorResponse'];
        };
      };
      403: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ErrorResponse'];
        };
      };
      404: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ErrorResponse'];
        };
      };
      409: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          'application/json': components['schemas']['ErrorResponse'];
        };
      };
    };
  };
  operator_communities: {
    parameters: {
      query?: {
        search?: string;
        after?: string;
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
          'application/json': components['schemas']['OperatorCommunity'][];
        };
      };
    };
  };
  operator_jobs: {
    parameters: {
      query: {
        kind: components['schemas']['OperatorJobKind'];
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
          'application/json': components['schemas']['OperatorJob'][];
        };
      };
    };
  };
  storage: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        user_id: string;
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
          'application/json': components['schemas']['StorageUsage'];
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
        /** @description Only profiles eligible for linking */
        linkable_only?: boolean;
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
  directory_profile: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        user_id: string;
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
          'application/json': components['schemas']['PublicProfile'];
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
