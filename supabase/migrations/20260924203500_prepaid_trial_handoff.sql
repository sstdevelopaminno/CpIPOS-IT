-- Preserve a confirmed prepaid Growth cycle until the full 7-day trial has ended.
-- Existing hourly cron job already invokes app.refresh_subscription_locks().
-- Only privileged control-plane writes may set tenant_data_lifecycle.metadata.
CREATE OR REPLACE FUNCTION app.refresh_subscription_locks()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'app'
AS $function$
DECLARE
  v_count integer := 0;
  v_due record;
BEGIN
  -- Convert verified, prepaid trials before applying the existing expiry lock.
  -- The row lock, latest-contract guard and status transition make repeated cron
  -- invocations idempotent without inserting a duplicate paid contract.
  FOR v_due IN
    SELECT l.tenant_id,
           l.metadata ->> 'prepaid_payment_reference' AS payment_reference,
           p.code AS package_code,
           c.auto_renew
      FROM public.tenant_data_lifecycle l
      JOIN LATERAL (
        SELECT c0.id, c0.package_id, c0.status, c0.billing_interval,
               c0.amount_per_cycle, c0.auto_renew,
               c0.metadata
          FROM public.tenant_subscription_contracts c0
         WHERE c0.tenant_id = l.tenant_id
         ORDER BY c0.created_at DESC, c0.id DESC
         LIMIT 1
      ) c ON true
      JOIN public.subscription_packages p ON p.id = c.package_id
     WHERE l.lifecycle_status = 'trial'
       AND l.access_locked = false
       AND l.data_home = 'primary'
       AND l.migration_status IN ('idle', 'completed', 'verified')
       AND l.trial_expires_at IS NOT NULL
       AND l.trial_expires_at <= now()
       AND l.metadata ->> 'prepaid_activation_state' = 'pending_trial_completion'
       AND coalesce(l.metadata ->> 'prepaid_payment_reference', '') ~ '^[A-Za-z0-9_-]{8,80}$'
       AND CASE
             WHEN coalesce(l.metadata ->> 'prepaid_amount_thb', '') ~ '^[0-9]+(\\.[0-9]{1,2})?
       AND p.is_active = true
       AND c.status = 'trial'
       AND c.billing_interval = 'monthly'
       AND c.amount_per_cycle = p.monthly_price
       AND c.metadata ->> 'prepaid_payment_reference' = l.metadata ->> 'prepaid_payment_reference'
    FOR UPDATE OF l SKIP LOCKED
  LOOP
    BEGIN
      PERFORM app.approve_paid_subscription(v_due.tenant_id, v_due.package_code, NULL::uuid, NULL::uuid);

      UPDATE public.tenant_data_lifecycle
         SET metadata = coalesce(metadata, '{}'::jsonb) ||
                        jsonb_build_object(
                          'prepaid_activation_state', 'activated_after_trial',
                          'prepaid_activated_at', now()
                        )
       WHERE tenant_id = v_due.tenant_id;

      UPDATE public.tenant_subscription_contracts
         SET auto_renew = v_due.auto_renew,
             metadata = coalesce(metadata, '{}'::jsonb) ||
                        jsonb_build_object(
                          'paid_after_trial', true,
                          'prepaid_payment_reference', v_due.payment_reference,
                          'prepaid_activation_state', 'activated_after_trial'
                        )
       WHERE id = (
         SELECT id FROM public.tenant_subscription_contracts
          WHERE tenant_id = v_due.tenant_id AND status = 'active'
          ORDER BY created_at DESC, id DESC
          LIMIT 1
       );
    EXCEPTION WHEN OTHERS THEN
      -- Failure must not lock a customer with verified prepaid evidence.
      -- The original pending state is preserved so the next cron run retries.
      RAISE WARNING 'prepaid trial conversion failed for tenant %, SQLSTATE %', v_due.tenant_id, SQLSTATE;
    END;
  END LOOP;

  -- Keep pre-existing expiry behavior for all other tenants.
  -- A matching, pre-approved payment awaiting conversion is exempt from the
  -- trial lock, including if a conversion attempt failed on this run.
  UPDATE public.tenant_data_lifecycle AS l
     SET access_locked = true,
         lock_reason = CASE WHEN l.lifecycle_status = 'trial'
                           THEN 'trial_expired'
                           ELSE 'subscription_expired' END,
         lifecycle_status = CASE WHEN l.lifecycle_status = 'trial'
                                 THEN 'expired'
                                 ELSE l.lifecycle_status END
   WHERE l.access_locked = false
     AND (
       (
         l.lifecycle_status = 'trial'
         AND l.trial_expires_at IS NOT NULL
         AND l.trial_expires_at <= now()
         AND NOT EXISTS (
           SELECT 1
             FROM public.tenant_subscription_contracts c
             JOIN public.subscription_packages p ON p.id = c.package_id
            WHERE c.id = (
              SELECT c2.id FROM public.tenant_subscription_contracts c2
               WHERE c2.tenant_id = l.tenant_id
               ORDER BY c2.created_at DESC, c2.id DESC LIMIT 1
            )
              AND l.metadata ->> 'prepaid_activation_state' = 'pending_trial_completion'
              AND coalesce(l.metadata ->> 'prepaid_payment_reference', '') ~ '^[A-Za-z0-9_-]{8,80}$'
              AND coalesce(l.metadata ->> 'prepaid_amount_thb', '') ~ '^[0-9]+(\.[0-9]{1,2})?$'
              AND (l.metadata ->> 'prepaid_amount_thb')::numeric = p.monthly_price
              AND c.metadata ->> 'prepaid_payment_reference' = l.metadata ->> 'prepaid_payment_reference'
              AND c.status = 'trial'
              AND c.amount_per_cycle = p.monthly_price
              AND c.billing_interval = 'monthly'
              AND p.is_active = true
         )
       )
       OR (
         l.lifecycle_status = 'active'
         AND l.subscription_expires_at IS NOT NULL
         AND l.subscription_expires_at <= now()
       )
     );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

             THEN (l.metadata ->> 'prepaid_amount_thb')::numeric = p.monthly_price
             ELSE false
           END
       AND p.is_active = true
       AND c.status = 'trial'
       AND c.billing_interval = 'monthly'
       AND c.amount_per_cycle = p.monthly_price
       AND c.metadata ->> 'prepaid_payment_reference' = l.metadata ->> 'prepaid_payment_reference'
    FOR UPDATE OF l SKIP LOCKED
  LOOP
    BEGIN
      PERFORM app.approve_paid_subscription(v_due.tenant_id, v_due.package_code, NULL::uuid, NULL::uuid);

      UPDATE public.tenant_data_lifecycle
         SET metadata = coalesce(metadata, '{}'::jsonb) ||
                        jsonb_build_object(
                          'prepaid_activation_state', 'activated_after_trial',
                          'prepaid_activated_at', now()
                        )
       WHERE tenant_id = v_due.tenant_id;

      UPDATE public.tenant_subscription_contracts
         SET auto_renew = v_due.auto_renew,
             metadata = coalesce(metadata, '{}'::jsonb) ||
                        jsonb_build_object(
                          'paid_after_trial', true,
                          'prepaid_payment_reference', v_due.payment_reference,
                          'prepaid_activation_state', 'activated_after_trial'
                        )
       WHERE id = (
         SELECT id FROM public.tenant_subscription_contracts
          WHERE tenant_id = v_due.tenant_id AND status = 'active'
          ORDER BY created_at DESC, id DESC
          LIMIT 1
       );
    EXCEPTION WHEN OTHERS THEN
      -- Failure must not lock a customer with verified prepaid evidence.
      -- The original pending state is preserved so the next cron run retries.
      RAISE WARNING 'prepaid trial conversion failed for tenant %, SQLSTATE %', v_due.tenant_id, SQLSTATE;
    END;
  END LOOP;

  -- Keep pre-existing expiry behavior for all other tenants.
  -- A matching, pre-approved payment awaiting conversion is exempt from the
  -- trial lock, including if a conversion attempt failed on this run.
  UPDATE public.tenant_data_lifecycle AS l
     SET access_locked = true,
         lock_reason = CASE WHEN l.lifecycle_status = 'trial'
                           THEN 'trial_expired'
                           ELSE 'subscription_expired' END,
         lifecycle_status = CASE WHEN l.lifecycle_status = 'trial'
                                 THEN 'expired'
                                 ELSE l.lifecycle_status END
   WHERE l.access_locked = false
     AND (
       (
         l.lifecycle_status = 'trial'
         AND l.trial_expires_at IS NOT NULL
         AND l.trial_expires_at <= now()
         AND NOT EXISTS (
           SELECT 1
             FROM public.tenant_subscription_contracts c
             JOIN public.subscription_packages p ON p.id = c.package_id
            WHERE c.id = (
              SELECT c2.id FROM public.tenant_subscription_contracts c2
               WHERE c2.tenant_id = l.tenant_id
               ORDER BY c2.created_at DESC, c2.id DESC LIMIT 1
            )
              AND l.metadata ->> 'prepaid_activation_state' = 'pending_trial_completion'
              AND coalesce(l.metadata ->> 'prepaid_payment_reference', '') ~ '^[A-Za-z0-9_-]{8,80}$'
              AND CASE
             WHEN coalesce(l.metadata ->> 'prepaid_amount_thb', '') ~ '^[0-9]+(\\.[0-9]{1,2})?
              AND c.metadata ->> 'prepaid_payment_reference' = l.metadata ->> 'prepaid_payment_reference'
              AND c.status = 'trial'
              AND c.amount_per_cycle = p.monthly_price
              AND c.billing_interval = 'monthly'
              AND p.is_active = true
         )
       )
       OR (
         l.lifecycle_status = 'active'
         AND l.subscription_expires_at IS NOT NULL
         AND l.subscription_expires_at <= now()
       )
     );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

             THEN (l.metadata ->> 'prepaid_amount_thb')::numeric = p.monthly_price
             ELSE false
           END
              AND c.metadata ->> 'prepaid_payment_reference' = l.metadata ->> 'prepaid_payment_reference'
              AND c.status = 'trial'
              AND c.amount_per_cycle = p.monthly_price
              AND c.billing_interval = 'monthly'
              AND p.is_active = true
         )
       )
       OR (
         l.lifecycle_status = 'active'
         AND l.subscription_expires_at IS NOT NULL
         AND l.subscription_expires_at <= now()
       )
     );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;
