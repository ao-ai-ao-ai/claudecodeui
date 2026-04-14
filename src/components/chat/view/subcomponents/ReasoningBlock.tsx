import { useState, useMemo } from 'react';
import { ChevronDown } from 'lucide-react';

interface ReasoningBlockProps {
  thinking: string;
  maxPreviewChars?: number;
}

export function ReasoningBlock({
  thinking,
  maxPreviewChars = 200,
}: ReasoningBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const { preview, isLong } = useMemo(() => {
    const isLong = thinking.length > maxPreviewChars;
    const preview = isLong
      ? thinking.substring(0, maxPreviewChars) + '…'
      : thinking;
    return { preview, isLong };
  }, [thinking, maxPreviewChars]);

  return (
    <div className="my-2 rounded-lg border-2 border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center gap-2 text-left hover:opacity-80"
      >
        <span className="text-sm text-amber-600 dark:text-amber-400">💭</span>
        <span className="flex-1 text-sm font-medium text-amber-900 dark:text-amber-100">
          Thinking
        </span>
        {isLong && (
          <ChevronDown
            className={`h-4 w-4 flex-shrink-0 transition-transform ${
              isExpanded ? 'rotate-180' : ''
            }`}
          />
        )}
      </button>

      {!isExpanded && isLong && (
        <div className="mt-2 text-xs italic text-amber-700 dark:text-amber-300">
          {preview}
        </div>
      )}

      {isExpanded && (
        <div className="mt-2 border-l-2 border-amber-300 pl-3 text-xs italic text-amber-700 dark:border-amber-700 dark:text-amber-300">
          <div className="whitespace-pre-wrap">{thinking}</div>
        </div>
      )}
    </div>
  );
}
