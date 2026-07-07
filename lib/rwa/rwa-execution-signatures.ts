import type { OffpayNetwork, RwaExecuteResponse } from '@/types/offpay-api';

export interface RwaExecutionSignatureLink {
  label: string;
  signature: string;
  network: OffpayNetwork;
}

function labelRwaExecutionStep(
  step: NonNullable<RwaExecuteResponse['signatures']>[number],
): string {
  if (step.id === 'base-create-delegate') return 'Delegate';
  if (step.id === 'er-approve-undelegate') return 'Finalize';
  if (step.id === 'base-settle') return 'Settle';
  if (step.target === 'magicblock_er_devnet') return 'MagicBlock';
  return 'Tx';
}

export function buildRwaExecutionSignatureLinks(
  execution: RwaExecuteResponse,
): RwaExecutionSignatureLink[] {
  if (execution.signatures != null && execution.signatures.length > 0) {
    return execution.signatures.map((step) => ({
      label: labelRwaExecutionStep(step),
      signature: step.signature,
      network: execution.network,
    }));
  }

  return [
    {
      label: 'Tx',
      signature: execution.signature,
      network: execution.network,
    },
  ];
}
