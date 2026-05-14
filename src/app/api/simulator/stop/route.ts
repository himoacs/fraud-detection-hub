import { NextResponse } from 'next/server';
import { stopSimulator } from '@/lib/simulator/service';

export async function POST() {
  try {
    const state = await stopSimulator();
    
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
