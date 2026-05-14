import { NextResponse } from 'next/server';
import { startSimulator, getMode } from '@/lib/simulator/service';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { fraudRate } = body;

    const state = await startSimulator(fraudRate);
    
    return NextResponse.json({
      success: true,
      state,
      mode: getMode(),
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
