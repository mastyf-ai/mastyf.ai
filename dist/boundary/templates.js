/**
 * CMQ Physical Network Isolation Templates.
 *
 * Generates Docker and Kubernetes infrastructure definitions enforcing
 * that the agent has NO physical network route to protected tools except
 * through Mastyf.
 */
import yaml from 'js-yaml';
export function generateDockerCompose(manifest) {
    const compose = {
        version: '3.8',
        networks: {
            'agent-network': {
                driver: 'bridge',
                internal: false,
            },
            'protected-network': {
                driver: 'bridge',
                internal: true, // Crucial: No external access and unroutable from agent container
            },
        },
        services: {
            agent: {
                image: 'mastyf/agent-sandbox:latest',
                container_name: `${manifest.agent.identity}`,
                environment: [
                    'MASTYF_PROXY_URL=http://mastyf-gateway:8443',
                    'HTTP_PROXY=http://mastyf-gateway:8443',
                    'HTTPS_PROXY=http://mastyf-gateway:8443',
                ],
                networks: ['agent-network'], // Only on agent-network
                depends_on: ['mastyf'],
                restart: 'unless-stopped',
            },
            mastyf: {
                image: 'mastyf/shield-gateway:latest',
                container_name: 'mastyf-gateway',
                ports: ['8443:8443', '4000:4000'],
                environment: [
                    'MASTYF_ENTERPRISE_MODE=true',
                    'MASTYF_FAIL_CLOSED=true',
                    'MASTYF_POLICY_PATH=/etc/mastyf/policy.yaml',
                ],
                volumes: ['./default-policy.yaml:/etc/mastyf/policy.yaml:ro'],
                networks: [
                    'agent-network', // Bridge to agent
                    'protected-network', // Bridge to protected tools
                ],
                restart: 'unless-stopped',
            },
        },
    };
    // Add protected tools attached ONLY to protected-network
    for (const s of manifest.protectedServices) {
        const safeName = s.name.replace(/[^a-zA-Z0-9_-]/g, '-');
        compose.services[safeName] = {
            image: `mcp-servers/${safeName}:latest`,
            container_name: safeName,
            networks: ['protected-network'], // Agent cannot route here!
            restart: 'unless-stopped',
        };
    }
    return yaml.dump(compose, { indent: 2 });
}
export function generateKubernetesNetworkPolicies(manifest) {
    const agentNs = 'agents';
    const toolsNs = 'protected-tools';
    const agentPolicy = {
        apiVersion: 'networking.k8s.io/v1',
        kind: 'NetworkPolicy',
        metadata: {
            name: 'agent-boundary-strict-egress',
            namespace: agentNs,
        },
        spec: {
            podSelector: {
                matchLabels: {
                    'mastyf.ai/role': 'agent',
                },
            },
            policyTypes: ['Egress'],
            egress: [
                {
                    // Allow egress ONLY to Mastyf Gateway
                    to: [
                        {
                            podSelector: {
                                matchLabels: {
                                    'app.kubernetes.io/name': 'mastyf-gateway',
                                },
                            },
                        },
                    ],
                    ports: [
                        { protocol: 'TCP', port: 8443 },
                        { protocol: 'TCP', port: 4000 },
                    ],
                },
                {
                    // Allow core DNS resolution
                    to: [
                        {
                            namespaceSelector: {},
                            podSelector: {
                                matchLabels: {
                                    'k8s-app': 'kube-dns',
                                },
                            },
                        },
                    ],
                    ports: [{ protocol: 'UDP', port: 53 }],
                },
            ],
        },
    };
    const toolsPolicy = {
        apiVersion: 'networking.k8s.io/v1',
        kind: 'NetworkPolicy',
        metadata: {
            name: 'protected-tools-strict-ingress',
            namespace: toolsNs,
        },
        spec: {
            podSelector: {
                matchLabels: {
                    'mastyf.ai/role': 'protected-tool',
                },
            },
            policyTypes: ['Ingress'],
            ingress: [
                {
                    // Ingress permitted ONLY from Mastyf Gateway pods
                    from: [
                        {
                            namespaceSelector: {
                                matchLabels: {
                                    'kubernetes.io/metadata.name': agentNs,
                                },
                            },
                            podSelector: {
                                matchLabels: {
                                    'app.kubernetes.io/name': 'mastyf-gateway',
                                },
                            },
                        },
                    ],
                },
            ],
        },
    };
    return `${yaml.dump(agentPolicy, { indent: 2 })}---\n${yaml.dump(toolsPolicy, { indent: 2 })}`;
}
//# sourceMappingURL=templates.js.map