import React from 'react';
import { useI18n } from '@/lib/i18n';

interface OpenChamberLogoProps {
  className?: string;
  width?: number;
  height?: number;
  isAnimated?: boolean;
}

// The export keeps its historical name so existing imports and persisted extension
// contracts remain stable. The rendered mark is the OpenLoop variable-width loop.
export const OpenChamberLogo: React.FC<OpenChamberLogoProps> = ({
  className = '',
  width = 70,
  height = 70,
  isAnimated = false,
}) => {
  const { t } = useI18n();

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label={t('openChamberLogo.aria.logo')}
    >
      <path
        d="M18.8 3.5C10.4 1.5 3.2 7.2 3.2 16.2C3.2 24.7 9.9 30.4 18 29.4C25.5 28.5 30.1 22.4 29.2 14.7C28.8 11.6 27.4 8.5 27 7C25.9 7.4 24.8 8.5 25.3 10.3C27.4 17.4 24.3 23.5 18 24.6C11.6 25.7 7.5 21.4 7.7 15.9C8 10.5 12.4 6.8 17.8 7.4C20.1 7.7 21.4 7 21.7 5.8C21.9 4.7 20.8 3.8 18.8 3.5Z"
        fill="currentColor"
        fillOpacity="0.2"
        stroke="currentColor"
        strokeWidth="0.9"
        strokeLinejoin="round"
      >
        {isAnimated ? (
          <animate attributeName="fill-opacity" values="0.16;0.32;0.16" dur="1.8s" repeatCount="indefinite" />
        ) : null}
      </path>
      <path
        d="M18.4 4.7C11.2 3.1 5 8 4.6 15.8C4.2 23.4 10.4 28.7 17.7 27.9C24.4 27.1 28.6 21.4 27.8 15.1C27.5 12.6 26.5 10 26.2 8.9"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.72"
        strokeWidth="0.65"
        strokeLinecap="round"
      />
      <path
        d="M8.4 10.7C10.6 6.9 14.7 5.2 18.2 5.9"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.38"
        strokeWidth="0.8"
        strokeLinecap="round"
      />
    </svg>
  );
};
