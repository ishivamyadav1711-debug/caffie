import { NextResponse } from 'next/server';
import { ConnectorHealthService } from '@/lib/social/connectors/ConnectorHealthService';

export async function GET() {
  try {
    const health = await ConnectorHealthService.getAllConnectorHealth();
    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      connectors: health,
    });
  } catch (error: any) {
    console.error('[Connectors API Error]:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to check connector health' },
      { status: 500 }
    );
  }
}
