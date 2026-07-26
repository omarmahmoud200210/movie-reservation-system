import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Hall } from '@prisma/client';
import { CreateHallDto } from './dto/create-hall.dto';
import { HallsRepository, HallWithSeats } from './halls.repository';
import { ScreeningsCache } from './screenings.cache';

@Injectable()
export class HallsService {
  constructor(
    private readonly hallsRepo: HallsRepository,
    private readonly screeningsCache: ScreeningsCache,
  ) {}

  async createHall(dto: CreateHallDto): Promise<HallWithSeats> {
    const hall = await this.hallsRepo.createHallWithSeats(dto);
    await this.screeningsCache.delHalls();
    return hall;
  }

  async getHall(id: number): Promise<HallWithSeats> {
    const hall = await this.hallsRepo.findHallWithSeats(id);
    if (!hall) {
      throw new NotFoundException(`Hall ${id} not found`);
    }
    return hall;
  }

  async listHalls(): Promise<Hall[]> {
    const cached = await this.screeningsCache.getHalls();
    if (cached) {
      return cached;
    }
    const halls = await this.hallsRepo.listHalls();
    await this.screeningsCache.setHalls(halls);
    return halls;
  }

  async deleteHall(id: number): Promise<Hall> {
    const hall = await this.hallsRepo.findHallWithSeats(id);
    if (!hall) {
      throw new NotFoundException(`Hall ${id} not found`);
    }
    if (await this.hallsRepo.hasReservations(id)) {
      throw new ConflictException(
        'Cannot delete a hall with existing reservations',
      );
    }
    const deleted = await this.hallsRepo.deleteHall(id);
    await this.screeningsCache.delHalls();
    return deleted;
  }
}
