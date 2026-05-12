Deno.serve(async (_req) => {
  return new Response(
    JSON.stringify({ message: "Hello from Hadas API!", status: "ok" }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }
  )
})
