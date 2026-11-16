import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, Min, ValidateNested } from 'class-validator';

const bigint = /^\d+$/;
export class PageDto { @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1; @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) per_page = 25; }
export class MenorQueryDto extends PageDto { @IsOptional() @Matches(bigint) persona_id?: string; @IsOptional() @Matches(/^\d{2}$/) departamento_codigo?: string; @IsOptional() @Matches(/^\d{4}$/) municipio_codigo?: string; }
export class VersionDto { @Type(() => Number) @IsInt() @Min(1) version!: number; }
export class MenorDto { @IsString() @Matches(bigint) persona_id!: string; @IsOptional() @IsString() direccion_ref?: string; @IsOptional() @Matches(/^\d{2}$/) departamento_codigo?: string; @IsOptional() @Matches(/^\d{4}$/) municipio_codigo?: string; @IsOptional() @IsString() comunidad_ref?: string; @IsOptional() @IsString() observaciones?: string; }
export class UpdateMenorDto extends VersionDto { @IsOptional() @IsString() direccion_ref?: string; @IsOptional() @Matches(/^\d{2}$/) departamento_codigo?: string; @IsOptional() @Matches(/^\d{4}$/) municipio_codigo?: string; @IsOptional() @IsString() comunidad_ref?: string; @IsOptional() @IsString() observaciones?: string; }
export class ResponsableDto { @IsString() @Matches(bigint) persona_id!: string; @IsIn(['MADRE', 'PADRE', 'ENCARGADO', 'TUTOR_LEGAL', 'OTRO']) tipo_relacion!: string; @IsDateString() fecha_inicio!: string; @IsOptional() @IsDateString() fecha_fin?: string; @IsOptional() @IsBoolean() estado?: boolean; }
export class UpdateResponsableDto extends VersionDto { @IsOptional() @IsIn(['MADRE', 'PADRE', 'ENCARGADO', 'TUTOR_LEGAL', 'OTRO']) tipo_relacion?: string; @IsOptional() @IsDateString() fecha_inicio?: string; @IsOptional() @IsDateString() fecha_fin?: string; @IsOptional() @IsBoolean() estado?: boolean; }
export class VacunaDto { @IsString() @Matches(/^[A-Z0-9_-]{2,40}$/) codigo!: string; @IsString() @IsNotEmpty() nombre!: string; @IsOptional() @IsString() fabricante?: string; @IsOptional() @IsBoolean() estado?: boolean; }
export class UpdateVacunaDto extends VersionDto { @IsOptional() @IsString() @Matches(/^[A-Z0-9_-]{2,40}$/) codigo?: string; @IsOptional() @IsString() @IsNotEmpty() nombre?: string; @IsOptional() @IsString() fabricante?: string; @IsOptional() @IsBoolean() estado?: boolean; }
export class EsquemaDto { @IsString() @Matches(/^[A-Z0-9_-]{2,40}$/) codigo!: string; @IsString() nombre!: string; @IsDateString() vigencia_desde!: string; @IsOptional() @IsDateString() vigencia_hasta?: string; @IsOptional() @IsBoolean() estado?: boolean; }
export class UpdateEsquemaDto extends VersionDto { @IsOptional() @IsString() @Matches(/^[A-Z0-9_-]{2,40}$/) codigo?: string; @IsOptional() @IsString() nombre?: string; @IsOptional() @IsDateString() vigencia_desde?: string; @IsOptional() @IsDateString() vigencia_hasta?: string; @IsOptional() @IsBoolean() estado?: boolean; }
export class DosisDto { @IsString() @Matches(bigint) vacuna_id!: string; @Type(() => Number) @IsInt() @Min(1) orden!: number; @Type(() => Number) @IsInt() @Min(0) edad_minima_dias!: number; @IsOptional() @Type(() => Number) @IsInt() @Min(0) edad_maxima_dias?: number; @IsOptional() @Type(() => Number) @IsInt() @Min(0) intervalo_minimo_dias?: number; @IsOptional() @Type(() => Number) @IsInt() @Min(1) intervalo_repeticion_dias?: number; }
export class AplicacionDto { @IsString() @Matches(bigint) esquema_dosis_id!: string; @IsOptional() @Type(() => Number) @IsInt() @Min(1) secuencia?: number; @IsDateString() fecha_aplicacion!: string; @IsOptional() @IsString() @Matches(bigint) jornada_id?: string; @IsOptional() @Matches(/^\d{2}$/) departamento_codigo?: string; @IsOptional() @Matches(/^\d{4}$/) municipio_codigo?: string; @IsOptional() @IsString() comunidad_ref?: string; @IsOptional() @IsString() observaciones?: string; }
/** Persona capturada desde la atención clínica; SSO conserva la titularidad de identidad. */
export class FamiliaPersonaDto { @IsString() @Matches(/^\d{13}$/) cui!: string; @IsString() @IsNotEmpty() primer_nombre!: string; @IsOptional() @IsString() segundo_nombre?: string; @IsOptional() @IsString() otros_nombres?: string; @IsString() @IsNotEmpty() primer_apellido!: string; @IsOptional() @IsString() segundo_apellido?: string; @IsOptional() @IsString() apellido_casada?: string; @IsDateString() fecha_nacimiento!: string; @IsIn(['FEMENINO', 'MASCULINO', 'INTERSEXUAL', 'NO_ESPECIFICA']) sexo!: string; }
export class FamiliaResponsableDto extends FamiliaPersonaDto { @IsIn(['MADRE', 'PADRE', 'ENCARGADO', 'TUTOR_LEGAL', 'OTRO']) tipo_relacion!: string; }
export class FamiliaRegistroDto { @ValidateNested() @Type(() => FamiliaPersonaDto) menor!: FamiliaPersonaDto; @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => FamiliaResponsableDto) responsables!: FamiliaResponsableDto[]; @IsOptional() @IsString() direccion_ref?: string; @IsOptional() @Matches(/^\d{2}$/) departamento_codigo?: string; @IsOptional() @Matches(/^\d{4}$/) municipio_codigo?: string; @IsOptional() @IsString() comunidad_ref?: string; @IsOptional() @IsString() observaciones?: string; }
export class PublicCardPinDto { @IsString() @Matches(/^\d{6}$/) pin!: string; }
export class MedicionDto { @IsDateString() fecha!: string; @Type(() => Number) @Min(0.1) @Max(300) peso_kg!: number; @Type(() => Number) @Min(20) @Max(250) talla_cm!: number; @IsOptional() @IsString() observaciones?: string; }
export class JornadaDto { @IsString() nombre!: string; @IsDateString() fecha_inicio!: string; @IsDateString() fecha_fin!: string; @IsOptional() @IsString() direccion_ref?: string; @IsOptional() @Matches(/^\d{2}$/) departamento_codigo?: string; @IsOptional() @Matches(/^\d{4}$/) municipio_codigo?: string; @IsOptional() @IsString() comunidad_ref?: string; @IsOptional() @IsIn(['PLANIFICADA', 'ACTIVA', 'CERRADA', 'CANCELADA']) estado?: string; @IsOptional() @IsArray() @Matches(bigint, { each: true }) vacuna_ids?: string[]; }
export class UpdateJornadaDto extends VersionDto { @IsOptional() @IsString() nombre?: string; @IsOptional() @IsDateString() fecha_inicio?: string; @IsOptional() @IsDateString() fecha_fin?: string; @IsOptional() @IsString() direccion_ref?: string; @IsOptional() @Matches(/^\d{2}$/) departamento_codigo?: string; @IsOptional() @Matches(/^\d{4}$/) municipio_codigo?: string; @IsOptional() @IsString() comunidad_ref?: string; @IsOptional() @IsIn(['PLANIFICADA', 'ACTIVA', 'CERRADA', 'CANCELADA']) estado?: string; }
export class JornadaNotificacionDto { @IsOptional() @IsString() titulo?: string; @IsOptional() @IsString() contenido?: string; }
export class PersonaSearchDto extends PageDto { @IsOptional() @Matches(/^\d{13}$/) cui?: string; @IsOptional() @IsString() q?: string; @IsOptional() @IsDateString() fecha_nacimiento?: string; }
export class ReadProjectionQueryDto extends PageDto {
  @IsOptional() @Matches(/^\d{2}$/) departamento_codigo?: string;
  @IsOptional() @Matches(/^\d{4}$/) municipio_codigo?: string;
  @IsOptional() @IsString() q?: string;
  // The protected clinical index supports progressive CUI lookup while the
  // user types. Creation and SSO identity records still require all 13 digits.
  @IsOptional() @Matches(/^\d{1,13}$/) cui?: string;
  @IsOptional() @IsDateString() fecha_nacimiento?: string;
  @IsOptional() @Matches(/^[A-Z0-9_-]{2,40}$/) vacuna_codigo?: string;
  @IsOptional() @IsIn(['APLICADA', 'FALTA']) estado_vacuna?: 'APLICADA' | 'FALTA';
  @IsOptional() @IsDateString() ultima_vacuna_desde?: string;
  @IsOptional() @IsDateString() ultima_vacuna_hasta?: string;
  @IsOptional() @IsIn(['ATRASADA', 'PROXIMA', 'PENDIENTE']) alerta_tipo?: string;
}
