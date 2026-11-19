const CLIENTS = [
  { name: 'Claude Desktop', tag: 'MCP native' },
  { name: 'Cursor AI', tag: 'Agent IDE' },
  { name: 'Windsurf / Codeium', tag: 'Flow agent' },
  { name: 'LangChain', tag: 'Agent mesh' },
  { name: 'LlamaIndex', tag: 'Data agents' },
  { name: 'OpenAI Swarm', tag: 'Multi-agent' },
  { name: 'Model Context Protocol', tag: 'Standard' },
  { name: 'AutoGen', tag: 'Conversational' },
  { name: 'Python SDK', tag: 'Integration' },
  { name: 'Docker Compose', tag: 'Container' },
] as const;

const STATS = [
  { value: '10+', label: 'Agent integrations' },
  { value: '~1.5 ms', label: 'Rule check, median' },
] as const;

export function Integrations() {
  return (
    <>
      <ul className="clients">
        {CLIENTS.map((client) => (
          <li key={client.name}>
            <span className="clients__name">{client.name}</span>
            <span className="clients__tag">{client.tag}</span>
          </li>
        ))}
      </ul>

      <dl className="metrics clients__metrics">
        {STATS.map((stat) => (
          <div key={stat.label} className="metric">
            <dt className="metric__label">{stat.label}</dt>
            <dd className="metric__value">{stat.value}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
