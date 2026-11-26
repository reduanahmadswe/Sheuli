export default function Logo({ size = 40, className = '', animated = false }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
      className={`${className} ${animated ? 'animate-bloom' : ''}`}
    >
      <circle cx="32" cy="32" r="32" fill="#0B1026" />
      <circle cx="10" cy="12" r="0.9" fill="#F8FAFC" className="animate-twinkle" />
      <circle cx="53" cy="10" r="0.7" fill="#F8FAFC" className="animate-twinkle" style={{ animationDelay: '0.6s' }} />
      <circle cx="56" cy="46" r="0.8" fill="#F8FAFC" className="animate-twinkle" style={{ animationDelay: '1.2s' }} />
      <circle cx="8" cy="48" r="0.6" fill="#F8FAFC" className="animate-twinkle" style={{ animationDelay: '1.8s' }} />
      <g fill="#F8FAFC">
        <ellipse cx="32" cy="16" rx="6" ry="11" />
        <ellipse cx="32" cy="16" rx="6" ry="11" transform="rotate(60 32 32)" />
        <ellipse cx="32" cy="16" rx="6" ry="11" transform="rotate(120 32 32)" />
        <ellipse cx="32" cy="16" rx="6" ry="11" transform="rotate(180 32 32)" />
        <ellipse cx="32" cy="16" rx="6" ry="11" transform="rotate(240 32 32)" />
        <ellipse cx="32" cy="16" rx="6" ry="11" transform="rotate(300 32 32)" />
      </g>
      <circle cx="32" cy="32" r="6" fill="#F97316" />
    </svg>
  );
}
