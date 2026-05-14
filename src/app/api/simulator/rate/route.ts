import { NextResponse } from 'next/server';
import { setRate, setFraudRate, getStats } from '@/lib/simulator/generator';

export async function POST(request: Request) {
  try {
    const { rate, fraudRate } = await request.json();
    
    if (typeof rate === 'number') {
      setRate(rate);
    }
    
    if (typeof fraudRate === 'number') {
      setFraudRate(fraudRate);
    }
    
    const state = getStats();
    
    return NextResponse.json({
      success: true,
      state,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
