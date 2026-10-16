import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client.js';
import { Block, VerifyResult, BlockWithTransactions } from '../types.js';
import { formatCredits } from '../utils/currency.js';
import { Modal } from '../components/Modal.js';
import {
  Layers,
  ShieldCheck,
  ShieldAlert,
  ChevronRight,
  Clock,
  Key,
} from 'lucide-react';

export const ExplorerView: React.FC = () => {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [selectedBlock, setSelectedBlock] = useState<BlockWithTransactions | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchExplorerData = useCallback(async () => {
    try {
      setIsLoading(true);
      const [blockList, verify] = await Promise.all([
        api.listBlocks(20),
        api.verifyChain(),
      ]);
      setBlocks(Array.isArray(blockList) ? blockList : []);
      setVerifyResult(verify);
    } catch {
      // ignore
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchExplorerData();
  }, [fetchExplorerData]);

  const handleSelectBlock = async (height: number) => {
    try {
      const detail = await api.getBlockDetails(height);
      setSelectedBlock(detail);
    } catch {
      // ignore
    }
  };

  return (
    <div className="space-y-4 max-w-3xl mx-auto" data-testid="explorer-view">
      {/* Chain Verification Status Badge */}
      <div
        className={`p-4 rounded-2xl border flex items-center justify-between shadow-2xs ${
          verifyResult?.valid
            ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
            : 'bg-rose-50 border-rose-200 text-rose-900'
        }`}
        data-testid="chain-verification-badge"
      >
        <div className="flex items-center space-x-2.5">
          {verifyResult?.valid ? (
            <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700">
              <ShieldCheck className="w-5 h-5" />
            </div>
          ) : (
            <div className="w-8 h-8 rounded-full bg-rose-100 flex items-center justify-center text-rose-700">
              <ShieldAlert className="w-5 h-5" />
            </div>
          )}
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-xs font-bold uppercase tracking-wider">
                {verifyResult?.valid ? 'Chain Cryptographically Valid' : 'Chain Verification Failed'}
              </span>
              <span className="text-[10px] px-1.5 py-0.2 bg-white/80 rounded font-mono font-semibold">
                Tip: #{verifyResult?.highest_block ?? 0}
              </span>
            </div>
            <p className="text-[11px] text-gray-500 font-mono mt-0.5 truncate max-w-xs sm:max-w-md">
              Hash: {verifyResult?.state_hash || 'Verified from block 0'}
            </p>
          </div>
        </div>

        <button
          onClick={fetchExplorerData}
          className="text-xs underline font-medium hover:text-emerald-950 cursor-pointer"
        >
          Verify Now
        </button>
      </div>

      {/* Recent Blocks List */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-2xs space-y-3">
        <div className="flex items-center justify-between border-b border-gray-100 pb-3">
          <div className="flex items-center space-x-2">
            <Layers className="w-4 h-4 text-[#7C5CFF]" />
            <h3 className="text-sm font-bold text-gray-900">Sealed Blocks Ledger</h3>
          </div>
          <span className="text-xs text-gray-400 font-mono">
            {blocks.length} recent blocks
          </span>
        </div>

        {isLoading ? (
          <div className="py-8 text-center text-gray-400 text-xs">Loading ledger blocks...</div>
        ) : blocks.length === 0 ? (
          <div className="py-8 text-center text-gray-400 text-xs">No blocks found on ledger.</div>
        ) : (
          <div className="divide-y divide-gray-100" data-testid="blocks-list">
            {blocks.map((block) => (
              <div
                key={block.id}
                onClick={() => handleSelectBlock(block.height)}
                className="py-3 flex items-center justify-between text-xs hover:bg-gray-50/70 px-2 -mx-2 rounded-xl transition-colors cursor-pointer group"
                data-testid={`block-item-${block.height}`}
              >
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 rounded-lg bg-gray-100 group-hover:bg-purple-50 group-hover:text-[#7C5CFF] flex items-center justify-center font-bold font-mono text-gray-700 transition-colors">
                    #{block.height}
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="font-mono font-medium text-gray-900 truncate max-w-[140px] sm:max-w-xs">
                        {block.hash.slice(0, 16)}...
                      </span>
                      <span className="px-1.5 py-0.2 bg-gray-100 text-gray-600 rounded text-[10px] font-mono">
                        {block.tx_count} {block.tx_count === 1 ? 'tx' : 'txs'}
                      </span>
                    </div>
                    <div className="text-[10px] text-gray-400 font-mono mt-0.5 flex items-center gap-2">
                      <span className="flex items-center gap-0.5">
                        <Clock className="w-3 h-3" />
                        {new Date(block.sealed_at).toLocaleTimeString()}
                      </span>
                      <span>diff: {block.difficulty_bits}</span>
                      <span>nonce: {block.nonce}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-1 text-gray-400 group-hover:text-gray-900">
                  <span className="text-[11px] hidden sm:inline">Details</span>
                  <ChevronRight className="w-4 h-4" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Block Details Modal */}
      {selectedBlock && (
        <Modal
          isOpen={true}
          onClose={() => setSelectedBlock(null)}
          title={`Block #${selectedBlock.block.height} Details`}
          subtitle={`Sealed with ${selectedBlock.block.validator_signatures.length} validator signatures`}
          maxWidth="lg"
        >
          <div className="space-y-4 text-xs font-mono">
            {/* Hash & Header Meta */}
            <div className="bg-gray-50 p-3 rounded-xl border border-gray-200/80 space-y-1.5 text-[11px]">
              <div>
                <span className="text-gray-400 block text-[10px]">Block Hash</span>
                <span className="text-gray-900 break-all select-all font-semibold">
                  {selectedBlock.block.hash}
                </span>
              </div>
              <div>
                <span className="text-gray-400 block text-[10px]">Previous Hash</span>
                <span className="text-gray-600 break-all select-all">
                  {selectedBlock.block.prev_hash}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 font-sans">
                <div>
                  <span className="text-gray-400 text-[10px] block">Transactions</span>
                  <span className="font-semibold text-gray-900">{selectedBlock.block.tx_count}</span>
                </div>
                <div>
                  <span className="text-gray-400 text-[10px] block">Difficulty</span>
                  <span className="font-semibold text-gray-900">{selectedBlock.block.difficulty_bits} bits</span>
                </div>
                <div>
                  <span className="text-gray-400 text-[10px] block">Nonce</span>
                  <span className="font-semibold text-gray-900">{selectedBlock.block.nonce}</span>
                </div>
                <div>
                  <span className="text-gray-400 text-[10px] block">Sealed At</span>
                  <span className="font-semibold text-gray-900">
                    {new Date(selectedBlock.block.sealed_at).toLocaleTimeString()}
                  </span>
                </div>
              </div>
            </div>

            {/* Validator Quorum Signatures */}
            <div>
              <h4 className="text-xs font-semibold text-gray-800 uppercase tracking-wider mb-1.5 flex items-center gap-1 font-sans">
                <Key className="w-3.5 h-3.5 text-[#7C5CFF]" />
                Validator Quorum Signatures ({selectedBlock.block.validator_signatures.length})
              </h4>
              <div className="space-y-1">
                {selectedBlock.block.validator_signatures.map((sig) => (
                  <div
                    key={sig.validator_id}
                    className="p-2 bg-gray-50/70 border border-gray-100 rounded-lg flex items-center justify-between text-[11px]"
                  >
                    <span className="font-semibold text-gray-800">@{sig.validator_id}</span>
                    <span className="text-gray-400 text-[10px] truncate max-w-[180px]">
                      {sig.signature.slice(0, 24)}...
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Included Transactions */}
            <div>
              <h4 className="text-xs font-semibold text-gray-800 uppercase tracking-wider mb-1.5 font-sans">
                Block Transactions ({selectedBlock.transactions.length})
              </h4>
              <div className="bg-gray-50 rounded-xl border border-gray-200/80 divide-y divide-gray-100 max-h-56 overflow-y-auto">
                {selectedBlock.transactions.map((tx) => (
                  <div key={tx.id} className="p-2.5 flex items-center justify-between text-[11px]">
                    <div>
                      <div className="flex items-center space-x-1.5 font-sans">
                        <span className="px-1.5 py-0.2 bg-gray-200 text-gray-700 rounded text-[9px] font-mono">
                          {tx.type}
                        </span>
                        <span className="text-gray-600 font-mono">
                          {tx.from_account || 'system'} → {tx.to_account || 'system'}
                        </span>
                      </div>
                      {tx.memo && <p className="text-[10px] text-gray-400 font-sans mt-0.5">{tx.memo}</p>}
                    </div>
                    <div className="text-right font-mono font-semibold text-gray-900">
                      {formatCredits(tx.amount_units)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
