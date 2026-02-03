export default function Home() {
  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
      <h1>Loyverse MCP Server</h1>
      <p>This server provides MCP tools for 5 Loyverse restaurant accounts:</p>
      <ul>
        <li>Harvey&apos;s Wings</li>
        <li>Bakugo Ramen</li>
        <li>Wildflower Tea House</li>
        <li>Fika Cafe</li>
        <li>Harvey&apos;s Chicken</li>
      </ul>
      <p>
        <strong>MCP Endpoint:</strong>{" "}
        <code>/api/mcp</code>
      </p>
      <p>
        Connect via Claude Desktop, Cursor, or claude.ai custom connectors.
      </p>
    </main>
  );
}
