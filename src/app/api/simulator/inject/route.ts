import { NextResponse } from 'next/server';
import { injectFraud } from '@/lib/simulator/service';
import type { FraudPattern } from '@/types';

export async function POST(request: Request) {
  try {
    const { pattern, count = 1 } = await request.json();
    
    const validPatterns: FraudPattern[] = [
      'card_testing',
      'account_takeover', 
      'velocity_abuse',
      'geo_anomaly',
      'amount_spike'
    ];
    
    if (!validPatterns.includes(pattern)) {
      return NextResponse.json(
        { success: false, error: 'Invalid fraud pattern' },
        { status: 400 }
      );
    }
    
    injectFraud(pattern, Math.min(count, 10));
    
    return NextResponse.json({
      success: true,
      message: `Injected ${count} ${pattern} transaction(s)`,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
