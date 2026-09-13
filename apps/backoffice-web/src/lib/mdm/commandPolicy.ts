import {
  type MdmCommandType,
  type MdmDeviceSnapshot,
  evaluateMdmEligibility,
} from './eligibility';

export type MdmActorRole = 'owner' | 'admin' | 'it_admin' | 'mdm_admin' | 'support' | 'viewer' | 'unknown';

export interface MdmCommandRequest {
  tenantId: string;
  deviceId: string;
  commandType: MdmCommandType;
  requestedBy?: string;
  requestedByRole?: MdmActorRole | string;
  reason?: string;
  payload?: Record<string, unknown>;
}

export interface MdmCommandValidationResult {
  accepted: boolean;
  status: 'accepted_for_queue' | 'rejected';
  reasons: string[];
  eligibility: ReturnType<typeof evaluateMdmEligibility>;
  auditEvent: {
    tenantId: string;
    deviceId: string;
    commandType: MdmCommandType;
    requestedBy?: string;
    requestedByRole: string;
    decision: 'accepted' | 'rejected';
    reasons: string[];
    reasonText?: string;
    payload: Record<string, unknown>;
  };
}

const OWNER_LEVEL_ROLES = new Set(['owner', 'admin', 'it_admin', 'mdm_admin']);
const SUPPORT_LEVEL_ROLES = new Set(['support']);
const VIEW_ONLY_ROLES = new Set(['viewer']);

const SENSITIVE_COMMANDS = new Set<MdmCommandType>([
  'lock_device',
  'unlock_device',
  'request_location',
  'start_remote_support',
  'install_app',
  'uninstall_app',
  'revoke_device_access',
  'financing_lock',
]);

const SUPPORT_ALLOWED_COMMANDS = new Set<MdmCommandType>([
  'diagnostics_ping',
  'sync_policy',
  'request_location',
  'start_remote_support',
  'stop_remote_support',
]);

const VIEWER_ALLOWED_COMMANDS = new Set<MdmCommandType>(['diagnostics_ping']);

const CORE_AGENT_PACKAGES = new Set([
  'com.cpipos',
  'com.cpipos.pos',
  'com.cpipos.mdm',
  'com.cuttingpoint.cpipos',
]);

const normalize = (value?: string | null): string => String(value ?? '').trim().toLowerCase();

const textValue = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const pushIfMissing = (reasons: string[], condition: boolean, reason: string): void => {
  if (condition && !reasons.includes(reason)) reasons.push(reason);
};

const roleCanRequestCommand = (role: string, commandType: MdmCommandType): boolean => {
  const normalizedRole = normalize(role);

  if (OWNER_LEVEL_ROLES.has(normalizedRole)) return true;
  if (SUPPORT_LEVEL_ROLES.has(normalizedRole)) return SUPPORT_ALLOWED_COMMANDS.has(commandType);
  if (VIEW_ONLY_ROLES.has(normalizedRole)) return VIEWER_ALLOWED_COMMANDS.has(commandType);

  return false;
};

export const validateMdmCommandRequest = (
  request: MdmCommandRequest,
  device: MdmDeviceSnapshot,
): MdmCommandValidationResult => {
  const reasons: string[] = [];
  const eligibility = evaluateMdmEligibility(device);
  const requestedByRole = normalize(request.requestedByRole) || 'unknown';
  const payload = request.payload ?? {};
  const reasonText = textValue(request.reason);

  pushIfMissing(reasons, !request.tenantId, 'tenant_id_required');
  pushIfMissing(reasons, !request.deviceId, 'device_id_required');
  pushIfMissing(reasons, normalize(request.tenantId) !== normalize(device.tenantId), 'tenant_mismatch');
  pushIfMissing(reasons, normalize(request.deviceId) !== normalize(device.deviceId), 'device_mismatch');
  pushIfMissing(reasons, !roleCanRequestCommand(requestedByRole, request.commandType), 'actor_role_not_authorized_for_command');
  pushIfMissing(
    reasons,
    !eligibility.allowedCommands.includes(request.commandType),
    'command_not_allowed_by_device_eligibility',
  );
  pushIfMissing(reasons, SENSITIVE_COMMANDS.has(request.commandType) && reasonText.length < 8, 'reason_required_for_sensitive_mdm_command');

  if (request.commandType === 'start_remote_support') {
    const sessionMode = normalize(textValue(payload.sessionMode));
    const ttlMinutes = Number(payload.ttlMinutes ?? 0);

    pushIfMissing(
      reasons,
      !['attended', 'company_kiosk'].includes(sessionMode),
      'remote_support_requires_attended_or_company_kiosk_mode',
    );
    pushIfMissing(reasons, sessionMode === 'silent', 'silent_remote_screen_access_denied');
    pushIfMissing(reasons, !Number.isFinite(ttlMinutes) || ttlMinutes <= 0 || ttlMinutes > 60, 'remote_support_ttl_must_be_1_to_60_minutes');
  }

  if (request.commandType === 'install_app' || request.commandType === 'uninstall_app') {
    pushIfMissing(reasons, textValue(payload.packageName).length === 0, 'android_package_name_required');
  }

  if (request.commandType === 'uninstall_app') {
    const packageName = normalize(textValue(payload.packageName));
    pushIfMissing(
      reasons,
      CORE_AGENT_PACKAGES.has(packageName),
      'core_agent_uninstall_blocked_use_revoke_access_policy',
    );
  }

  const accepted = reasons.length === 0;

  return {
    accepted,
    status: accepted ? 'accepted_for_queue' : 'rejected',
    reasons,
    eligibility,
    auditEvent: {
      tenantId: request.tenantId,
      deviceId: request.deviceId,
      commandType: request.commandType,
      requestedBy: request.requestedBy,
      requestedByRole,
      decision: accepted ? 'accepted' : 'rejected',
      reasons,
      reasonText,
      payload,
    },
  };
};
