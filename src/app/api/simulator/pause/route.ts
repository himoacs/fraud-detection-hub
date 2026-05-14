import { NextResponse } from 'next/server';
import { pause, resume } from '@/lib/simulator/generator';

export async function POST(request: Request) {
  try {
    const { action } = await request.json();
    
    const state = action === 'pause' ? pause() : resume();
    
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
