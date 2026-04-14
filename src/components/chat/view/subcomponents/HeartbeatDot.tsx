import { useMemo } from 'react';

interface HeartbeatDotProps {
  isConnected: boolean;
  lastMessageTimestamp?: number;
}

export function HeartbeatDot({
  isConnected,
  lastMessageTimestamp,
}: HeartbeatDotProps) {
  const { color, animation, label } = useMemo(() => {
    if (!isConnected) {
      return {
        color: 'bg-red-500 dark:bg-red-400',
        animation: 'animate-pulse',
        label: 'Reconnecting...',
      };
    }

    const now = Date.now();
    const timeSinceLastMessage = lastMessageTimestamp
      ? now - lastMessageTimestamp
      : null;

    // Yellow if no message in last 5 seconds
    if (timeSinceLastMessage && timeSinceLastMessage > 5000) {
      return {
        color: 'bg-yellow-500 dark:bg-yellow-400',
        animation: '',
        label: 'Idle',
      };
    }

    // Green if connected and recent activity
    return {
      color: 'bg-green-500 dark:bg-green-400',
      animation: 'animate-pulse',
      label: 'Connected',
    };
  }, [isConnected, lastMessageTimestamp]);

  return (
    <div
      className={`h-2 w-2 rounded-full ${color} ${animation}`}
      title={label}
    />
  );
}
