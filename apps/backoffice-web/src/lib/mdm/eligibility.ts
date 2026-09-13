export type MdmPlatform = 'android' | 'web' | 'ios' | 'windows' | 'unknown';

export type OwnershipType =
  | 'company_owned'
  | 'company_financed'
  | 'customer_owned'
  | 'byod'
  | 'unknown';

export type EnrollmentMode =
  | 'android_enterprise_device_owner'
  | 'fully_managed'
  | 'dedicated_device'
  | 'work_profile'
  | 'none'
  | 'unknown';

export type AppFlavor =
  | 'web-production'
  | 'web_production'
  | 'production_web'
  | 'native'
  | 'native2'
  | 'unknown';

export type MdmCapability =
  | 'mdm_core'
  | 'remote_lock'
  | 'location'
  | 'remote_support'
  | 'app_install'
  | 'app_uninstall'
  | 'policy_sync';

export type MdmCommandType =
  | 'lock_device'
  | 'unlock_device'
  | 'request_location'
  | 'start_remote_support'
  | 'stop_remote_support'
  | 'install_app'
  | 'uninstall_app'
  | 'sync_policy'
  | 'revoke_device_access'
  | 'financing_lock'
  | 'diagnostics_ping';

export interface MdmDeviceSnapshot {
  tenantId?: string;
  deviceId?: string;
  platform?: string;
  appVersion?: string;
  appFlavor?: string;
  nativeGeneration?: string | null;
  ownershipType?: string;
  enrollmentMode?: string;
  isDeviceOwner?: boolean;
  capabilities?: string[];
}

export interface MdmEligibilityDecision {
  mode: 'full_mdm' | 'diagnostics_only';
  isEligible: boolean;
  reasons: string[];
  allowedCommands: MdmCommandType[];
  deniedCommands: MdmCommandType[];
}

export const ANDROID_WEB_PRODUCTION_MDM_VERSION = '1.0.23';

const WEB_PRODUCTION_FLAVORS = new Set(['web-production', 'web_production', 'production_web']);
const COMPANY_OWNERSHIP_TYPES = new Set(['company_owned', 'company_financed']);
const DEVICE_OWNER_ENROLLMENT_MODES = new Set([
  'android_enterprise_device_owner',
  'fully_managed',
  'dedicated_device',
]);

const FULL_MDM_COMMANDS: MdmCommandType[] = [
  'lock_device',
  'unlock_device',
  'request_location',
  'start_remote_support',
  'stop_remote_support',
  'install_app',
  'uninstall_app',
  'sync_policy',
  'revoke_device_access',
  'financing_lock',
  'diagnostics_ping',
];

const DIAGNOSTICS_ONLY_COMMANDS: MdmCommandType[] = ['diagnostics_ping'];

const normalize = (value?: string | null): string => String(value ?? '').trim().toLowerCase();

const hasCapability = (device: MdmDeviceSnapshot, capability: MdmCapability): boolean => {
  return (device.capabilities ?? []).map(normalize).includes(capability);
};

const unique = <T>(items: T[]): T[] => Array.from(new Set(items));

export const isAndroidWebProductionMdmCandidate = (device: MdmDeviceSnapshot): boolean => {
  return (
    normalize(device.platform) === 'android' &&
    normalize(device.appVersion) === ANDROID_WEB_PRODUCTION_MDM_VERSION &&
    WEB_PRODUCTION_FLAVORS.has(normalize(device.appFlavor))
  );
};

export const evaluateMdmEligibility = (device: MdmDeviceSnapshot): MdmEligibilityDecision => {
  const reasons: string[] = [];

  if (normalize(device.platform) !== 'android') {
    reasons.push('platform_must_be_android');
  }

  if (normalize(device.appVersion) === '1.0.12') {
    reasons.push('android_lts_1_0_12_is_excluded');
  }

  if (normalize(device.appVersion) !== ANDROID_WEB_PRODUCTION_MDM_VERSION) {
    reasons.push('android_app_version_must_be_exactly_1_0_23');
  }

  if (!WEB_PRODUCTION_FLAVORS.has(normalize(device.appFlavor))) {
    reasons.push('app_flavor_must_be_web_production');
  }

  if (normalize(device.nativeGeneration) === '2.0' || normalize(device.appFlavor) === 'native2') {
    reasons.push('native_2_0_excluded_from_full_mdm');
  }

  if (!COMPANY_OWNERSHIP_TYPES.has(normalize(device.ownershipType))) {
    reasons.push('device_must_be_company_owned_or_company_financed');
  }

  if (!DEVICE_OWNER_ENROLLMENT_MODES.has(normalize(device.enrollmentMode))) {
    reasons.push('device_must_be_android_enterprise_device_owner');
  }

  if (device.isDeviceOwner !== true) {
    reasons.push('android_device_owner_required');
  }

  if (!hasCapability(device, 'mdm_core')) {
    reasons.push('mdm_core_capability_required');
  }

  if (reasons.length > 0) {
    return {
      mode: 'diagnostics_only',
      isEligible: false,
      reasons: unique(reasons),
      allowedCommands: DIAGNOSTICS_ONLY_COMMANDS,
      deniedCommands: FULL_MDM_COMMANDS.filter((command) => !DIAGNOSTICS_ONLY_COMMANDS.includes(command)),
    };
  }

  const allowedCommands: MdmCommandType[] = ['diagnostics_ping'];

  if (hasCapability(device, 'policy_sync')) {
    allowedCommands.push('sync_policy');
  }

  if (hasCapability(device, 'remote_lock')) {
    allowedCommands.push('lock_device', 'unlock_device', 'financing_lock', 'revoke_device_access');
  }

  if (hasCapability(device, 'location')) {
    allowedCommands.push('request_location');
  }

  if (hasCapability(device, 'remote_support')) {
    allowedCommands.push('start_remote_support', 'stop_remote_support');
  }

  if (hasCapability(device, 'app_install')) {
    allowedCommands.push('install_app');
  }

  if (hasCapability(device, 'app_uninstall')) {
    allowedCommands.push('uninstall_app');
  }

  const dedupedAllowed = unique(allowedCommands);

  return {
    mode: 'full_mdm',
    isEligible: true,
    reasons: ['eligible_android_1_0_23_web_production_device_owner'],
    allowedCommands: dedupedAllowed,
    deniedCommands: FULL_MDM_COMMANDS.filter((command) => !dedupedAllowed.includes(command)),
  };
};

export const canRunMdmCommand = (device: MdmDeviceSnapshot, commandType: MdmCommandType): boolean => {
  return evaluateMdmEligibility(device).allowedCommands.includes(commandType);
};
