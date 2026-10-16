import React from 'react';
import { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon: Icon,
  title,
  description,
  action,
}) => {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center bg-white border border-neutral-200/80 rounded-2xl">
      <div className="w-12 h-12 rounded-full bg-neutral-100 flex items-center justify-center text-neutral-400 mb-3">
        <Icon className="w-6 h-6 text-neutral-400" />
      </div>
      <h4 className="text-sm font-semibold text-neutral-900 mb-1">{title}</h4>
      <p className="text-xs text-neutral-500 max-w-sm mb-4 leading-relaxed">{description}</p>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="px-4 py-2 bg-neutral-900 text-white rounded-lg text-xs font-medium hover:bg-neutral-800 transition-colors shadow-2xs cursor-pointer"
        >
          {action.label}
        </button>
      )}
    </div>
  );
};
