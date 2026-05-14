import { addSSEClient, removeSSEClient } from '@/lib/simulator/service';

export async function GET() {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      addSSEClient(controller);
    },
    cancel(controller) {
      removeSSEClient(controller);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
