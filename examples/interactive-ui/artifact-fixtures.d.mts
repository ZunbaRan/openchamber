import type { HTMLArtifactResultEnvelope } from '../../packages/ui/src/lib/interactive-ui/artifactResult';

export const staticNeuralNetworkArtifact: HTMLArtifactResultEnvelope;
export const learningRateSimulatorArtifact: HTMLArtifactResultEnvelope;
export const topologyExplorerArtifact: HTMLArtifactResultEnvelope;
export const htmlArtifactFixtures: Readonly<{
  staticNeuralNetwork: HTMLArtifactResultEnvelope;
  learningRateSimulator: HTMLArtifactResultEnvelope;
  topologyExplorer: HTMLArtifactResultEnvelope;
}>;
