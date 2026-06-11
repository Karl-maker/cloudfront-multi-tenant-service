import { createLlmsText } from "@/lib/llms";

export const dynamic = "force-static";

export function GET() {
  return new Response(createLlmsText(), {
    headers: {
      "content-type": "text/plain; charset=utf-8"
    }
  });
}

