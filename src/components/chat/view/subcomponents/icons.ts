import {
  FileText,
  Terminal,
  Edit3,
  Search,
  FileUp,
  Zap,
  AlertCircle,
} from 'lucide-react';

export function getToolIcon(toolName: string) {
  switch (toolName.toLowerCase()) {
    case 'read':
      return FileText;
    case 'bash':
      return Terminal;
    case 'edit':
      return Edit3;
    case 'write':
      return FileUp;
    case 'grep':
    case 'search':
      return Search;
    default:
      return Zap;
  }
}
