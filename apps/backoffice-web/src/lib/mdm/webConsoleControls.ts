import {
  type MdmCommandType,
  type MdmDeviceSnapshot,
  evaluateMdmEligibility,
} from './eligibility';

export interface MdmConsoleControlState {
  commandType: MdmCommandType;
  label: string;
  enabled: boolean;
  mode: 'full_mdm' | 'diagnostics_only';
  disabledReason?: string;
  requiresReason: boolean;
  requiresOwnerApproval: boolean;
}

const CONTROL_LABELS: Record<MdmCommandType, string> = {
  diagnostics_ping: 'Diagnostics Ping',
  sync_policy: 'Sync Policy',
  lock_device: 'Lock Device',
  unlock_device: 'Unlock Device',
  request_location: 'Request Location',
  start_remote_support: 'Start Remote Support',
  stop_remote_support: 'Stop Remote Support',
  install_app: 'Install App',
  uninstall_app: 'Uninstall App',
  revoke_device_access: 'Revoke Device Access',
  financing_lock: 'Financing Lock',
};

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

const OWNER_APPROVAL_COMMANDS = new Set<MdmCommandType>([
  'lock_device',
  'unlock_device',
  'uninstall_app',
  'revoke_device_access',
  'financing_lock',
]);

const DEFAULT_CONSOLE_ORDER: MdmCommandType[] = [
  'diagnostics_ping',
  'sync_policy',
  'request_location',
  'start_remote_support',
  'stop_remote_support',
  'lock_device',
  'unlock_device',
  'financing_lock',
  'install_app',
  'uninstall_app',
  'revoke_device_access',
];

export const getMdmConsoleControls = (device: MdmDeviceSnapshot): MdmConsoleControlState[] => {
  const decision = evaluateMdmEligibility(device);
  const firstDisabledReason = decision.reasons[0] ?? 'command_not_allowed_for_this_device';

  return DEFAULT_CONSOLE_ORDER.map((commandType) => {
    const enabled = decision.allowedCommands.includes(commandType);

    return {
      commandType,
      label: CONTROL_LABELS[commandType],
      enabled,
      mode: decision.mode,
      disabledReason: enabled ? undefined : firstDisabledReason,
      requiresReason: SENSITIVE_COMMANDS.has(commandType),
      requiresOwnerApproval: OWNER_APPROVAL_COMMANDS.has(commandType),
    };
  });
};

export const getMdmConsoleBanner = (device: MdmDeviceSnapshot): { tone: 'success' | 'warning'; message: string } => {
  const decision = evaluateMdmEligibility(device);

  if (decision.isEligible) {
    return {
      tone: 'success',
      message: 'Full MDM controls are available for this Android 1.0.23 Web Production Device Owner device.',
    };
  }

  return {
    tone: 'warning',
    message: `Diagnostics only. Full MDM is blocked: ${decision.reasons.join(', ')}`,
  };
};
