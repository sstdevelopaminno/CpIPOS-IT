import { describe, expect, it } from 'vitest';

import { evaluateMdmEligibility } from '@/lib/mdm/eligibility';
import { validateMdmCommandRequest } from '@/lib/mdm/commandPolicy';
import { getMdmConsoleControls } from '@/lib/mdm/webConsoleControls';

const eligibleDevice = {
  tenantId: 'tenant-001',
  deviceId: 'POS-001',
  platform: 'android',
  appVersion: '1.0.23',
  appFlavor: 'web-production',
  nativeGeneration: null,
  ownershipType: 'company_financed',
  enrollmentMode: 'android_enterprise_device_owner',
  isDeviceOwner: true,
  capabilities: [
    'mdm_core',
    'remote_lock',
    'location',
    'remote_support',
    'app_install',
    'app_uninstall',
    'policy_sync',
  ],
};

describe('Android 1.0.23 Web Production MDM eligibility', () => {
  it('allows full MDM for enrolled company financed Android 1.0.23 Web Production devices', () => {
    const decision = evaluateMdmEligibility(eligibleDevice);
    expect(decision.mode).toBe('full_mdm');
    expect(decision.isEligible).toBe(true);
    expect(decision.allowedCommands).toContain('lock_device');
    expect(decision.allowedCommands).toContain('uninstall_app');
    expect(decision.allowedCommands).toContain('start_remote_support');
  });

  it('keeps remote lock command-granular until separate executors are advertised', () => {
    const decision = evaluateMdmEligibility({
      ...eligibleDevice,
      capabilities: ['mdm_core', 'policy_sync', 'remote_lock'],
    });
    expect(decision.allowedCommands).toContain('lock_device');
    expect(decision.allowedCommands).not.toContain('unlock_device');
    expect(decision.allowedCommands).not.toContain('financing_lock');
    expect(decision.allowedCommands).not.toContain('revoke_device_access');
  });

  it('keeps unmanaged Android devices in diagnostics only mode', () => {
    const decision = evaluateMdmEligibility({
      tenantId: 'tenant-001', deviceId: 'FF0001-POS-01', platform: 'android', appVersion: '1.0.21',
      appFlavor: 'web-production', ownershipType: 'company_financed', enrollmentMode: 'none',
      isDeviceOwner: false, capabilities: ['mdm_core'],
    });
    expect(decision.mode).toBe('diagnostics_only');
    expect(decision.allowedCommands).toEqual(['diagnostics_ping']);
    expect(decision.reasons).toContain('android_app_version_must_be_exactly_1_0_23');
    expect(decision.reasons).toContain('android_device_owner_required');
  });

  it('excludes Android 1.0.12 LTS and Native 2.0 from full MDM', () => {
    const lts = evaluateMdmEligibility({ ...eligibleDevice, appVersion: '1.0.12' });
    const native2 = evaluateMdmEligibility({ ...eligibleDevice, nativeGeneration: '2.0' });
    expect(lts.mode).toBe('diagnostics_only');
    expect(lts.reasons).toContain('android_lts_1_0_12_is_excluded');
    expect(native2.mode).toBe('diagnostics_only');
    expect(native2.reasons).toContain('native_2_0_excluded_from_full_mdm');
  });

  it('excludes BYOD and customer-owned devices from full MDM', () => {
    const byod = evaluateMdmEligibility({ ...eligibleDevice, ownershipType: 'byod' });
    const customerOwned = evaluateMdmEligibility({ ...eligibleDevice, ownershipType: 'customer_owned' });
    expect(byod.mode).toBe('diagnostics_only');
    expect(customerOwned.mode).toBe('diagnostics_only');
  });
});

describe('MDM command policy validation', () => {
  it('allows IT admin to request a sensitive command only with sufficient reason', () => {
    const accepted = validateMdmCommandRequest({
      tenantId: 'tenant-001', deviceId: 'POS-001', commandType: 'lock_device', requestedBy: 'it-admin-001',
      requestedByRole: 'it_admin', reason: 'Managed device security incident requires temporary lock',
    }, eligibleDevice);
    const rejected = validateMdmCommandRequest({
      tenantId: 'tenant-001', deviceId: 'POS-001', commandType: 'lock_device', requestedByRole: 'it_admin', reason: 'lock',
    }, eligibleDevice);
    expect(accepted.accepted).toBe(true);
    expect(rejected.accepted).toBe(false);
    expect(rejected.reasons).toContain('reason_required_for_sensitive_mdm_command');
  });

  it('rejects silent remote screen access', () => {
    const result = validateMdmCommandRequest({
      tenantId: 'tenant-001', deviceId: 'POS-001', commandType: 'start_remote_support', requestedByRole: 'mdm_admin',
      reason: 'Troubleshooting active store support case', payload: { sessionMode: 'silent', ttlMinutes: 30 },
    }, eligibleDevice);
    expect(result.accepted).toBe(false);
    expect(result.reasons).toContain('silent_remote_screen_access_denied');
  });

  it('blocks uninstalling the CpIPOS core agent package', () => {
    const result = validateMdmCommandRequest({
      tenantId: 'tenant-001', deviceId: 'POS-001', commandType: 'uninstall_app', requestedByRole: 'it_admin',
      reason: 'Attempt to remove protected core agent package', payload: { packageName: 'com.cpipos.mdm' },
    }, eligibleDevice);
    expect(result.accepted).toBe(false);
    expect(result.reasons).toContain('core_agent_uninstall_blocked_use_revoke_access_policy');
  });

  it('keeps non-eligible devices limited to diagnostics in the IT console', () => {
    const controls = getMdmConsoleControls({ ...eligibleDevice, ownershipType: 'customer_owned' });
    expect(controls.find((item) => item.commandType === 'diagnostics_ping')?.enabled).toBe(true);
    expect(controls.find((item) => item.commandType === 'lock_device')?.enabled).toBe(false);
  });
});
