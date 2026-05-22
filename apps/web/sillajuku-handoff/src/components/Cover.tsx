interface CoverProps {
  gradient: string;
  className?: string;
  pattern?: boolean;
}

export function Cover({ gradient, className = '', pattern = true }: CoverProps) {
  return (
    <div className={`${gradient} ${className} relative overflow-hidden`}>
      {pattern && (
        <>
          <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_30%_30%,white_0%,transparent_50%)]" />
          <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_70%_70%,white_0%,transparent_50%)]" />
          <div className="absolute top-0 right-0 w-1/2 h-1/2 opacity-10 bg-gradient-to-bl from-white to-transparent" />
        </>
      )}
    </div>
  );
}
