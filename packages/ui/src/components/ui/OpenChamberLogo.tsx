import React from 'react';
import { useI18n } from '@/lib/i18n';
import openLoopProductIcon from '@/assets/openloop-product-icon.png';

interface OpenChamberLogoProps {
  className?: string;
  width?: number;
  height?: number;
  isAnimated?: boolean;
}

// The export keeps its historical name so existing imports and persisted extension
// contracts remain stable. Reuse the product artwork so startup, empty states, and
// branded surfaces cannot drift into a separate approximation of the OpenLoop mark.
export const OpenChamberLogo: React.FC<OpenChamberLogoProps> = ({
  className = '',
  width = 70,
  height = 70,
  isAnimated = false,
}) => {
  const { t } = useI18n();

  return (
    <img
      src={openLoopProductIcon}
      width={width}
      height={height}
      className={`${isAnimated ? 'animate-pulse' : ''} ${className}`.trim()}
      alt={t('openChamberLogo.aria.logo')}
      draggable={false}
    />
  );
};
