# Scheduled routines

Open **Routines** from the sidebar to run an agent prompt on a recurring schedule. A routine belongs
to one environment and project. Choose the provider subscription, model, permission mode, time zone,
and a standard five-field cron expression before saving it.

The selected provider instance is the subscription or account used for the run. Every occurrence
creates a normal T3 Code thread, so its messages, status, diff, and provider usage remain visible in
the ordinary project history. **Run now** queues the routine for the environment's next scheduler
sweep.

Choose a plain-language schedule preset for common hourly, daily, weekday, weekly, or monthly work,
or switch to a custom cron expression. Existing routines can be duplicated as a clean draft when you
want the same prompt and provider subscription on another project or schedule.

The environment's T3 server must be running. If it was offline at the scheduled time, the routine
runs once after the server returns rather than replaying every missed occurrence. Pause a routine to
keep its configuration without running it, or delete it to remove it from that environment.
