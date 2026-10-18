'use client';

import React from 'react';
import { LeadDetailDrawer, LeadDetailDrawerProps } from './LeadDetailDrawer';

export type LeadDetailModalProps = LeadDetailDrawerProps;

export const LeadDetailModal: React.FC<LeadDetailModalProps> = (props) => {
  return <LeadDetailDrawer {...props} />;
};

export default LeadDetailModal;
