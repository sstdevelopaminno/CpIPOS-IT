-- Lock reminder worker internals to server/cron execution paths only.
revoke all on function app.consume_subscription_reminder_worker_token(text) from public,anon,authenticated;
grant execute on function app.consume_subscription_reminder_worker_token(text) to service_role;

revoke all on function app.invoke_subscription_reminder_worker() from public,anon,authenticated;
grant execute on function app.invoke_subscription_reminder_worker() to service_role;
