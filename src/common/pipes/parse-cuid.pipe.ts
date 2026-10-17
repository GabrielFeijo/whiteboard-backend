import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

@Injectable()
export class ParseCuidPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (typeof value !== 'string' || !SAFE_ID_PATTERN.test(value.trim())) {
      throw new BadRequestException('Invalid identifier parameter');
    }
    return value.trim();
  }
}
