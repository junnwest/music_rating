import { User } from 'lucide-react';

interface UserAvatarProps {
  avatarUrl?: string | null;
  size?: number;
  className?: string;
}

export default function UserAvatar({ avatarUrl, size = 32, className = '' }: UserAvatarProps) {
  const iconSize = Math.round(size * 0.52);

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt="avatar"
        width={size}
        height={size}
        className={`rounded-full object-cover flex-shrink-0 ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <div
      className={`rounded-full bg-[#EFEFEF] flex items-center justify-center flex-shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      <User size={iconSize} strokeWidth={1.8} color="#8E8E8E" />
    </div>
  );
}
