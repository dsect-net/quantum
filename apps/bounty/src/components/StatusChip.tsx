import React from 'react';
import { BountyStatus, QuestStatus } from '../types.js';

interface StatusChipProps {
  status: BountyStatus | QuestStatus | string;
  size?: 'sm' | 'md';
}

export const StatusChip: React.FC<StatusChipProps> = ({ status, size = 'sm' }) => {
  const norm = status.toLowerCase();

  let bg = 'bg-gray-100 text-gray-700 border-gray-200';
  let label = status;

  switch (norm) {
    case 'open':
      bg = 'bg-emerald-50 text-emerald-700 border-emerald-200';
      label = 'Open';
      break;
    case 'claimed':
      bg = 'bg-amber-50 text-amber-700 border-amber-200';
      label = 'Claimed';
      break;
    case 'submitted':
      bg = 'bg-indigo-50 text-indigo-700 border-indigo-200';
      label = 'Submitted';
      break;
    case 'accepted':
    case 'paid':
      bg = 'bg-purple-50 text-[#7C5CFF] border-[#7C5CFF]/30';
      label = norm === 'paid' ? 'Paid' : 'Accepted';
      break;
    case 'passed':
      bg = 'bg-emerald-50 text-emerald-700 border-emerald-200';
      label = 'Passed';
      break;
    case 'failed':
    case 'cancelled':
      bg = 'bg-rose-50 text-rose-700 border-rose-200';
      label = norm === 'failed' ? 'Failed' : 'Cancelled';
      break;
    case 'disputed':
      bg = 'bg-orange-50 text-orange-700 border-orange-200';
      label = 'Disputed';
      break;
  }

  const px = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm';

  return (
    <span
      className={`inline-flex items-center font-medium rounded-full border ${px} ${bg} capitalize tracking-wide transition-colors`}
      data-testid={`status-chip-${norm}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current mr-1.5 opacity-80" />
      {label}
    </span>
  );
};
