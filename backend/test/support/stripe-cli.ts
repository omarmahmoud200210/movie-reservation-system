import { spawn, execFileSync } from 'child_process';

// shell: true is required below, not just convenient: on Windows the Stripe CLI installs as a
// .cmd shim, and Windows' CreateProcess() cannot execute .cmd/.bat files directly — spawn/
// execFileSync throw EINVAL without a shell to interpret them (naming "stripe.cmd" explicitly
// doesn't help; this is a Node/Windows limitation, not a PATH resolution issue). This is safe
// here because every argument is locally-sourced and non-adversarial: forwardToUrl is built
// internally from the test's own 127.0.0.1 server address, apiKey comes from a gitignored local
// file the developer controls, and paymentId is a DB-generated number — none of this is
// user/network input, so there's no injection surface despite shell:true.
const READY_LINE = /Ready! You are using Stripe API Version .* Your webhook signing secret is (whsec_\w+)/;

export interface WebhookRelay {
  webhookSecret: string;
  stop: () => void;
}

/** Spawns `stripe listen`, forwarding real webhook deliveries to the given local URL. Resolves
 * once the CLI reports it's ready and reveals the per-session signing secret it printed —
 * that secret (not any dashboard secret) is what `stripe.webhooks.constructEvent` must verify
 * against for events relayed by this process. */
export function startWebhookRelay(
  forwardToUrl: string,
  apiKey: string,
  timeoutMs = 20_000,
): Promise<WebhookRelay> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'stripe',
      ['listen', '--forward-to', forwardToUrl, '--api-key', apiKey, '--skip-update'],
      { stdio: ['ignore', 'pipe', 'pipe'], shell: true },
    );

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`stripe listen did not become ready within ${timeoutMs}ms`));
    }, timeoutMs);

    let buffer = '';
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf-8');
      const match = buffer.match(READY_LINE);
      if (match) {
        clearTimeout(timer);
        child.stdout?.off('data', onData);
        child.stderr?.off('data', onData);
        resolve({
          webhookSecret: match[1],
          stop: () => child.kill(),
        });
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/** Fires a real `checkout.session.completed` event via `stripe trigger`, overriding the
 * session's metadata.paymentId so it correlates to the payment the test created. This creates
 * real fixture objects (product/price/session) on the Stripe test account — verified empirically
 * that `--override checkout_session:metadata.paymentId=<id>` threads through to the relayed
 * event's data.object.metadata. */
export function triggerCheckoutCompleted(paymentId: number, apiKey: string): void {
  execFileSync(
    'stripe',
    [
      'trigger',
      'checkout.session.completed',
      '--override',
      `checkout_session:metadata.paymentId=${paymentId}`,
      '--api-key',
      apiKey,
    ],
    { stdio: 'inherit', shell: true },
  );
}
