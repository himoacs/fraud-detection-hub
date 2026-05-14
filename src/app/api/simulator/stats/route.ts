import { NextResponse } from 'next/server';
import { getStats } from '@/lib/simulator/generator';

export async function GET() {
  try {
    const stats = getStats();
    
    return NextResponse.json({
      success: true,
      ...stats,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
