import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { getToolIcon } from './icons';

interface ActionBlockProps {
  toolName: string;
  toolId: string;
  toolInput: unknown;
  status: 'running' | 'completed' | 'error';
  result?: unknown;
  onFileOpen?: (filePath: string) => void;
}

export function ActionBlock({
  toolName,
  toolId,
  toolInput,
  status,
  result,
}: ActionBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const ToolIcon = getToolIcon(toolName);

  const statusColors = {
    running: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
    completed: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',
    error: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
  };

  const statusIcons = {
    running: 'text-blue-600 dark:text-blue-400 animate-spin',
    completed: 'text-green-600 dark:text-green-400',
    error: 'text-red-600 dark:text-red-400',
  };

  const friendlyLabel = toolName === 'Read' ? `Read ${extractPath(toolInput)}` :
    toolName === 'Bash' ? `Run bash` :
    toolName === 'Edit' ? `Edit file` :
    toolName === 'Grep' ? `Search files` :
    toolName === 'Write' ? `Write file` :
    toolName;

  return (
    <div
      className={`my-2 rounded-lg border-2 p-3 transition-colors ${statusColors[status]}`}
    >
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center gap-2 text-left hover:opacity-80"
      >
        <ToolIcon className={`h-4 w-4 flex-shrink-0 ${statusIcons[status]}`} />
        <span className="flex-1 text-sm font-medium text-gray-900 dark:text-gray-100">
          {friendlyLabel}
        </span>
        <ChevronDown
          className={`h-4 w-4 flex-shrink-0 transition-transform ${
            isExpanded ? 'rotate-180' : ''
          }`}
        />
      </button>

      {isExpanded && (
        <div className="mt-3 space-y-2">
          {toolInput && (
            <div>
              <div className="text-xs font-medium text-gray-600 dark:text-gray-400">
                Input
              </div>
              <pre className="mt-1 overflow-x-auto rounded bg-gray-100 p-2 text-xs dark:bg-gray-800">
                <code className="text-gray-800 dark:text-gray-200">
                  {typeof toolInput === 'string'
                    ? toolInput
                    : JSON.stringify(toolInput, null, 2)}
                </code>
              </pre>
            </div>
          )}
          {result && (
            <div>
              <div className="text-xs font-medium text-gray-600 dark:text-gray-400">
                Result
              </div>
              <pre className="mt-1 overflow-x-auto rounded bg-gray-100 p-2 text-xs dark:bg-gray-800">
                <code className="text-gray-800 dark:text-gray-200">
                  {typeof result === 'string'
                    ? result
                    : JSON.stringify(result, null, 2)}
                </code>
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function extractPath(input: unknown): string {
  if (typeof input === 'object' && input !== null) {
    const obj = input as Record<string, unknown>;
    return String(obj.file_path || obj.path || obj.pattern || '...');
  }
  return '...';
}
