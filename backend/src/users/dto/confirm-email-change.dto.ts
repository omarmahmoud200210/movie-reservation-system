import { Length } from 'class-validator';

export class ConfirmEmailChangeDto {
  @Length(6, 6)
  code: string;
}
