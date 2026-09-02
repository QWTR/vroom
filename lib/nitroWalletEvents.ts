export type NitroWalletUpdate = {
  nitroBalance: number;
  rankingPoints?: number;
  spendablePoints?: number;
};

type Listener = (update: NitroWalletUpdate) => void;
const listeners = new Set<Listener>();

export function emitNitroWalletUpdate(input: Partial<NitroWalletUpdate> | null | undefined): void {
  const nitroBalance = Number(input?.nitroBalance);
  if (!Number.isFinite(nitroBalance)) return;
  const update: NitroWalletUpdate = {
    nitroBalance: Math.max(0, Math.trunc(nitroBalance)),
    ...(Number.isFinite(Number(input?.rankingPoints)) ? { rankingPoints: Number(input?.rankingPoints) } : {}),
    ...(Number.isFinite(Number(input?.spendablePoints)) ? { spendablePoints: Number(input?.spendablePoints) } : {}),
  };
  listeners.forEach((listener) => listener(update));
}

export function subscribeNitroWallet(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
